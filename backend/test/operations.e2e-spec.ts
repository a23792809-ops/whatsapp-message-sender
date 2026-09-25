import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import 'temporal-polyfill/global';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';
import { db } from './../src/prisma/db.js';

const RUN = `ops-e2e-${process.pid}-${Date.now()}`;
type AnyRow = Record<string, any>;

describe('Operations & analytics (e2e)', () => {
  let app: INestApplication<App>;
  let cookie: string;
  const fetchMock = vi.fn();
  const createdCustomers: string[] = [];
  const createdTemplates: string[] = [];
  const createdCampaigns: string[] = [];
  /** Setting keys this suite writes, so it can restore them afterwards. */
  const touchedSettings: string[] = [];
  /**
   * Audit ids that predate this suite. The trail is append-only, so teardown
   * removes exactly the rows these tests created and nothing else.
   */
  let preExistingAuditIds = new Set<string>();

  beforeAll(async () => {
    process.env.WHATSAPP_MODE = 'dry';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-ops-secret';
    process.env.AUTH_SESSION_HOURS = '168';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const existing = await db.orm.public.AuditLog.all();
    preExistingAuditIds = new Set(((Array.isArray(existing) ? existing : []) as AnyRow[]).map((r) => r.id as string));

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'e2e-password' })
      .expect(201);
    cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  afterAll(async () => {
    // Restore settings to their pre-suite state.
    for (const key of touchedSettings) {
      const found = await db.orm.public.AppSetting.where({ key }).all();
      for (const row of (Array.isArray(found) ? found : []) as AnyRow[]) {
        await db.orm.public.AppSetting.where({ key: row.key }).delete();
      }
    }
    for (const campaignId of createdCampaigns) {
      const msgs = await db.orm.public.Message.where({ campaignId }).all();
      for (const row of (Array.isArray(msgs) ? msgs : []) as AnyRow[]) {
        await db.orm.public.Message.where({ id: row.id }).delete();
      }
      await db.orm.public.Campaign.where({ id: campaignId }).delete();
    }
    for (const id of createdCustomers) await db.orm.public.Customer.where({ id }).delete();
    for (const id of createdTemplates) await db.orm.public.MessageTemplate.where({ id }).delete();
    // Remove exactly the audit rows this suite created, by primary key.
    const logs = await db.orm.public.AuditLog.all();
    for (const row of (Array.isArray(logs) ? logs : []) as AnyRow[]) {
      if (!preExistingAuditIds.has(row.id)) await db.orm.public.AuditLog.where({ id: row.id }).delete();
    }

    await app.close();
    for (const key of ['WHATSAPP_MODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'AUTH_SECRET', 'AUTH_SESSION_HOURS']) {
      delete process.env[key];
    }
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      throw new Error('network access is not allowed in the operations e2e suite');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('records a real audit trail for campaign actions and serves it paginated', async () => {
    const template = (await db.orm.public.MessageTemplate
      .create({ name: `${RUN}-tpl`, body: 'Hello {{customer_name}}', isActive: true, metaName: null, metaLanguage: 'en' })
      .then((t: AnyRow) => t)) as AnyRow;
    createdTemplates.push(template.id);

    const made = await db.orm.public.Customer.createAll([
      { mobile: '919111100001', name: `${RUN} One`, variables: null },
      { mobile: '919111100002', name: `${RUN} Two`, variables: null },
    ]);
    const customers = (Array.isArray(made) ? made : [made]) as AnyRow[];
    createdCustomers.push(...customers.map((c) => c.id));

    const created = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', cookie)
      .send({
        name: `${RUN}-campaign`,
        templateId: template.id,
        customerIds: customers.map((c) => c.id),
        throttleMs: 5000,
      })
      .expect(201);
    const campaignId = created.body.id as string;
    createdCampaigns.push(campaignId);

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/start`)
      .set('Cookie', cookie)
      .expect(201);

    // Both actions must be on the trail.
    const byAction = await request(app.getHttpServer())
      .get('/audit-logs?action=CAMPAIGN_START&pageSize=50')
      .set('Cookie', cookie)
      .expect(200);
    expect(byAction.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(byAction.body.data.some((r: AnyRow) => r.entityId === campaignId)).toBe(true);

    // Filters narrow server-side.
    const createLogs = await request(app.getHttpServer())
      .get('/audit-logs?action=CAMPAIGN_CREATE&entityType=campaign')
      .set('Cookie', cookie)
      .expect(200);
    expect(createLogs.body.data.every((r: AnyRow) => r.action === 'CAMPAIGN_CREATE' && r.entityType === 'campaign')).toBe(true);

    // Search reaches the message column.
    const searched = await request(app.getHttpServer())
      .get(`/audit-logs?search=${encodeURIComponent(RUN)}&pageSize=50`)
      .set('Cookie', cookie)
      .expect(200);
    expect(searched.body.data.length).toBeGreaterThanOrEqual(1);
    expect(searched.body.data.every((r: AnyRow) => String(r.message).includes(RUN))).toBe(true);

    // Deterministic order: createdAt DESC then id DESC.
    const ordered = await request(app.getHttpServer())
      .get('/audit-logs?pageSize=5')
      .set('Cookie', cookie)
      .expect(200);
    const rows = ordered.body.data as AnyRow[];
    for (let i = 1; i < rows.length; i += 1) {
      const prev = Date.parse(String(rows[i - 1].createdAt));
      const cur = Date.parse(String(rows[i].createdAt));
      expect(prev).toBeGreaterThanOrEqual(cur);
      if (prev === cur) expect(String(rows[i - 1].id) >= String(rows[i].id)).toBe(true);
    }

    // Pagination envelope maths.
    const p1 = await request(app.getHttpServer()).get('/audit-logs?page=1&pageSize=2').set('Cookie', cookie).expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.page).toBe(1);
    expect(p1.body.meta.pageSize).toBe(2);
    expect(p1.body.meta.totalPages).toBe(Math.max(1, Math.ceil(p1.body.meta.total / 2)));

    // pageSize is bounded.
    const bounded = await request(app.getHttpServer()).get('/audit-logs?pageSize=5000').set('Cookie', cookie).expect(400);
    expect(JSON.stringify(bounded.body.message)).toContain('pageSize');

    // No token or credential ever lands in the trail.
    const all = await request(app.getHttpServer()).get('/audit-logs?pageSize=200').set('Cookie', cookie).expect(200);
    const dump = JSON.stringify(all.body);
    expect(dump).not.toContain('Bearer ');
    expect(dump.toLowerCase()).not.toContain('"accesstoken"');
  });

  it('persists settings, validates them, and refuses secrets', async () => {
    const before = await request(app.getHttpServer()).get('/settings').set('Cookie', cookie).expect(200);
    expect(before.body).toEqual({
      defaultCountryCode: expect.any(String),
      defaultThrottleMs: expect.any(Number),
      defaultTemplateLanguage: expect.any(String),
      maxRetryAttempts: expect.any(Number),
      appName: expect.any(String),
    });
    touchedSettings.push('appName', 'defaultThrottleMs', 'maxRetryAttempts');

    // Valid write persists and reads back.
    const put = await request(app.getHttpServer())
      .put('/settings')
      .set('Cookie', cookie)
      .send({ appName: `${RUN} Console`, defaultThrottleMs: 12000, maxRetryAttempts: 4 })
      .expect(200);
    expect(put.body).toMatchObject({ appName: `${RUN} Console`, defaultThrottleMs: 12000, maxRetryAttempts: 4 });

    const reread = await request(app.getHttpServer()).get('/settings').set('Cookie', cookie).expect(200);
    expect(reread.body.appName).toBe(`${RUN} Console`);

    // Values are genuinely in the database, not just echoed.
    const stored = await db.orm.public.AppSetting.where({ key: 'defaultThrottleMs' }).first();
    expect(String((stored as AnyRow).value)).toBe('12000');

    // Range validation is enforced over HTTP.
    await request(app.getHttpServer()).put('/settings').set('Cookie', cookie).send({ defaultThrottleMs: 10 }).expect(400);
    await request(app.getHttpServer()).put('/settings').set('Cookie', cookie).send({ maxRetryAttempts: 99 }).expect(400);
    await request(app.getHttpServer())
      .put('/settings')
      .set('Cookie', cookie)
      .send({ defaultTemplateLanguage: 'not-a-language' })
      .expect(400);

    // A secret cannot be stored. The global whitelist strips unknown keys, so
    // the request is accepted but nothing is written.
    await request(app.getHttpServer())
      .put('/settings')
      .set('Cookie', cookie)
      .send({ whatsappAccessToken: 'EAAGZZ-super-secret-value' })
      .expect(200);
    const all = await db.orm.public.AppSetting.all();
    expect(JSON.stringify(all)).not.toContain('EAAGZZ-super-secret-value');
    expect((all as AnyRow[]).every((r) => !String(r.key).toLowerCase().includes('token'))).toBe(true);

    // And the service refuses it outright when called directly.
    const { SettingsService } = await import('./../src/settings/settings.service.js');
    const { SettingsController } = await import('./../src/settings/settings.controller.js');
    const { AuditService } = await import('./../src/audit/audit.service.js');
    const direct = new SettingsService({ client: db } as any, { get: () => undefined } as any);
    const ctrl = new SettingsController(direct, new AuditService({ client: db } as any));
    await expect(ctrl.update({ accessToken: 'nope' } as any)).rejects.toThrow();
  });

  it('serves dashboard analytics computed in the database', async () => {
    const stats = await request(app.getHttpServer()).get('/analytics/dashboard').set('Cookie', cookie).expect(200);
    const b = stats.body;
    expect(b.customers).toEqual({
      total: expect.any(Number),
      pending: expect.any(Number),
      sent: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(b.campaigns.total).toBeGreaterThanOrEqual(0);
    expect(b.messages).toEqual({
      total: expect.any(Number),
      sent: expect.any(Number),
      failed: expect.any(Number),
      pending: expect.any(Number),
    });
    expect(typeof b.successRate).toBe('number');
    expect(b.successRate).toBeGreaterThanOrEqual(0);
    expect(b.successRate).toBeLessThanOrEqual(100);
    expect(Array.isArray(b.recentCampaigns)).toBe(true);
    expect(b.recentCampaigns.length).toBeLessThanOrEqual(5);
    // recent campaigns are newest first
    const times = b.recentCampaigns.map((c: AnyRow) => Date.parse(String(c.createdAt)));
    for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);

    // The figures must agree with a direct database count.
    const counted = (await db.orm.public.Message.aggregate((a: any) => ({ n: a.count() }))) as AnyRow;
    expect(b.messages.total).toBe(Number(counted.n));
    const campaignCount = (await db.orm.public.Campaign.aggregate((a: any) => ({ n: a.count() }))) as AnyRow;
    expect(b.campaigns.total).toBe(Number(campaignCount.n));

    // No success rate is claimed when nothing has an outcome.
    if (b.messages.sent + b.messages.failed === 0) expect(b.successRate).toBe(0);
  });

  it('paginates message history with filters and deterministic order', async () => {
    const page = await request(app.getHttpServer())
      .get('/messages?page=1&pageSize=5')
      .set('Cookie', cookie)
      .expect(200);
    expect(page.body).toEqual({
      data: expect.any(Array),
      meta: { total: expect.any(Number), page: 1, pageSize: 5, totalPages: expect.any(Number) },
    });
    expect(page.body.data.length).toBeLessThanOrEqual(5);
    expect(page.body.meta.totalPages).toBe(Math.max(1, Math.ceil(page.body.meta.total / 5)));

    const rows = page.body.data as AnyRow[];
    for (let i = 1; i < rows.length; i += 1) {
      const prev = Date.parse(String(rows[i - 1].createdAt));
      const cur = Date.parse(String(rows[i].createdAt));
      expect(prev).toBeGreaterThanOrEqual(cur);
      if (prev === cur) expect(String(rows[i - 1].id) >= String(rows[i].id)).toBe(true);
    }

    // Status filter is applied by the database.
    const sent = await request(app.getHttpServer()).get('/messages?status=SENT&pageSize=50').set('Cookie', cookie).expect(200);
    expect((sent.body.data as AnyRow[]).every((m) => m.status === 'SENT')).toBe(true);
    expect(sent.body.meta.total).toBe(sent.body.data.length);

    // campaignId filter.
    const scoped = await request(app.getHttpServer())
      .get(`/messages?campaignId=${createdCampaigns[0]}&pageSize=50`)
      .set('Cookie', cookie)
      .expect(200);
    expect((scoped.body.data as AnyRow[]).every((m) => m.campaignId === createdCampaigns[0])).toBe(true);

    // Search filter.
    const searched = await request(app.getHttpServer())
      .get(`/messages?search=${encodeURIComponent(RUN)}&pageSize=50`)
      .set('Cookie', cookie)
      .expect(200);
    expect((searched.body.data as AnyRow[]).every((m) => String(m.customerName).includes(RUN))).toBe(true);

    // pageSize bound is enforced by the DTO.
    await request(app.getHttpServer()).get('/messages?pageSize=5000').set('Cookie', cookie).expect(400);
  });

  it('records an audit entry when a campaign action fails, and never leaks the token', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/does-not-exist/start')
      .set('Cookie', cookie)
      .expect(404);

    const failures = await request(app.getHttpServer())
      .get('/audit-logs?status=FAILURE&action=CAMPAIGN_START&pageSize=50')
      .set('Cookie', cookie)
      .expect(200);
    expect(failures.body.meta.total).toBeGreaterThanOrEqual(1);
    const entry = failures.body.data[0] as AnyRow;
    expect(entry.entityId).toBe('does-not-exist');
    expect(String(entry.message).toLowerCase()).not.toContain('token');
    // No response body from the failed action is persisted verbatim.
    expect(Object.keys(entry).sort()).toEqual(
      ['action', 'actor', 'createdAt', 'entityId', 'entityType', 'id', 'message', 'status'].sort(),
    );
  });
});
