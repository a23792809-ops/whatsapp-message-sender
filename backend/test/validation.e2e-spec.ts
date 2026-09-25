import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';
import { WhatsAppService } from './../src/whatsapp/whatsapp.service.js';
import { db } from './../src/prisma/db.js';

/** Audit rows are a byproduct of the controller-level audit hooks. */
type AuditRow = { id: string };

describe('Request DTO validation (e2e)', () => {
  let app: INestApplication<App>;
  const fetchMock = vi.fn();
  let authCookie: string;
  /**
   * These specs deliberately reach past the DTO layer, so the audit hooks fire.
   * Snapshot the ids that predate the run and drop only the new ones afterwards,
   * leaving any real audit history untouched.
   */
  let preExistingAuditIds = new Set<string>();
  let previousWhatsAppMode: string | undefined;
  let previousPhoneNumberId: string | undefined;
  let previousAccessToken: string | undefined;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-test-secret';
    process.env.AUTH_SESSION_HOURS = '168';
    // Pin the delivery mode so this suite is hermetic. Without it the result
    // depends on the developer's local .env: a machine configured with
    // WHATSAPP_MODE=live and an empty access token now fails closed, which is
    // the correct production behaviour but not what the DTO tests below assert.
    previousWhatsAppMode = process.env.WHATSAPP_MODE;
    process.env.WHATSAPP_MODE = 'dry';
    previousPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    previousAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = '';
    process.env.WHATSAPP_ACCESS_TOKEN = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    const existingAudit = await db.orm.public.AuditLog.all();
    preExistingAuditIds = new Set(
      ((Array.isArray(existingAudit) ? existingAudit : []) as AuditRow[]).map((r) => r.id),
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'e2e-password' })
      .expect(201);
    authCookie = (loginRes.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_SESSION_HOURS;
    if (previousWhatsAppMode === undefined) delete process.env.WHATSAPP_MODE;
    else process.env.WHATSAPP_MODE = previousWhatsAppMode;
    if (previousPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhoneNumberId;
    if (previousAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = previousAccessToken;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.e2e' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /templates with an empty body returns 400', () => {
    return request(app.getHttpServer())
      .post('/templates')
      .set('Cookie', authCookie)
      .send({})
      .expect(400);
  });

  it('POST /campaigns without customerIds returns 400', () => {
    return request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', authCookie)
      .send({ name: 'Test campaign', templateId: 'some-template-id' })
      .expect(400);
  });

  it('POST /whatsapp/test without "to" returns 400', () => {
    return request(app.getHttpServer())
      .post('/whatsapp/test')
      .set('Cookie', authCookie)
      .send({ message: 'Hello from Vitest' })
      .expect(400);
  });

  it('POST /whatsapp/test with an invalid phone number returns 400', () => {
    return request(app.getHttpServer())
      .post('/whatsapp/test')
      .set('Cookie', authCookie)
      .send({ to: '12', message: 'Hello' })
      .expect(400);
  });

  it('POST /whatsapp/test with an invalid template language returns 400', () => {
    return request(app.getHttpServer())
      .post('/whatsapp/test')
      .set('Cookie', authCookie)
      .send({ to: '9876543210', templateName: 'bharat_gas_delivery', language: 'e' })
      .expect(400);
  });

  it('POST /whatsapp/test with a template payload succeeds without contacting Meta', async () => {
    const res = await request(app.getHttpServer())
      .post('/whatsapp/test')
      .set('Cookie', authCookie)
      .send({
        to: '9876543210',
        message: 'Fallback text',
        templateName: 'bharat_gas_delivery',
        language: 'en',
        parameters: ['Ram', 'AB123'],
      })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.error).toBeUndefined();
    if (res.body.mode === 'template') {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent.to).toBe('919876543210');
      expect(sent.type).toBe('template');
      expect(sent.template).toEqual({
        name: 'bharat_gas_delivery',
        language: 'en',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ram' }, { type: 'text', text: 'AB123' }] },
        ],
      });
    } else {
      expect(res.body.mode).toBe('dry');
      expect(res.body.whatsappId).toMatch(/^dry-/);
    }
  });

  it('POST /whatsapp/test fails closed with a configuration error when live mode has no credentials', async () => {
    // Live mode without Meta credentials must not return a simulated success.
    // Restored in a finally block so a failure here cannot leak into other tests.
    const savedMode = process.env.WHATSAPP_MODE;
    const savedPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const savedToken = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_MODE = 'live';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '';
    process.env.WHATSAPP_ACCESS_TOKEN = '';

    try {
      const wa = app.get(WhatsAppService);
      const res = await request(app.getHttpServer())
        .post('/whatsapp/test')
        .set('Cookie', authCookie)
        .send({ to: '9876543210', message: 'Should not be sent' })
        .expect(201);

      expect(res.body.ok).toBe(false);
      expect(res.body.whatsappId).toBeUndefined();
      expect(res.body.error).toMatchObject({ httpStatus: 503, type: 'WHATSAPP_NOT_CONFIGURED' });
      expect(res.body.error.message).toContain('WHATSAPP_PHONE_NUMBER_ID');
      expect(res.body.error.message).toContain('WHATSAPP_ACCESS_TOKEN');
      // The endpoint still responds 2xx with a structured body rather than
      // throwing, so the campaign engine can treat it as a normal send failure.
      expect(wa.status().dryRun).toBe(false);
      expect(wa.status().configured).toBe(false);
      // Nothing was sent to Meta.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.WHATSAPP_MODE = savedMode;
      process.env.WHATSAPP_PHONE_NUMBER_ID = savedPhoneId;
      process.env.WHATSAPP_ACCESS_TOKEN = savedToken;
    }
  });

  it('POST /campaigns with a valid body but non-existent template passes DTO validation and reaches service validation (404, not 400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', authCookie)
      .send({
        name: 'Service validation test campaign',
        templateId: '00000000-0000-0000-0000-000000000001',
        customerIds: ['00000000-0000-0000-0000-000000000002'],
      })
      .expect(404);
    expect(res.body.message).toContain('Template');
    expect(res.body.message).toContain('not found');
  });

  afterAll(async () => {
    const auditRows = await db.orm.public.AuditLog.all();
    for (const row of (Array.isArray(auditRows) ? auditRows : []) as AuditRow[]) {
      if (!preExistingAuditIds.has(row.id)) await db.orm.public.AuditLog.where({ id: row.id }).delete();
    }
  });
});