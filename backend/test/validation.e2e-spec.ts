import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';

describe('Request DTO validation (e2e)', () => {
  let app: INestApplication<App>;
  const fetchMock = vi.fn();
  let authCookie: string;

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-test-secret';
    process.env.AUTH_SESSION_HOURS = '168';

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
});