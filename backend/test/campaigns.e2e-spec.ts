import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import 'temporal-polyfill/global';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';
import { db } from './../src/prisma/db.js';

const RUN_ID = `e2e-campaign-${process.pid}-${Date.now()}`;

type AnyRow = Record<string, any>;

/** Resolves a promise once the condition holds, or rejects after `timeout`. */
async function until(fn: () => boolean | Promise<boolean>, timeout = 40_000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeout) throw new Error('condition was not reached in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('Campaign engine persistence (e2e)', () => {
  let app: INestApplication<App>;
  let authCookie: string;
  const fetchMock = vi.fn();

  const createdCustomers: string[] = [];
  const createdTemplates: string[] = [];
  const createdCampaigns: string[] = [];
  /**
   * Campaign actions now write audit rows through the controller. The trail is
   * append-only, so teardown removes exactly the ids these tests created and
   * leaves any real audit history untouched.
   */
  let preExistingAuditIds = new Set<string>();

  beforeAll(async () => {
    // Hard guarantees that this suite can never contact Meta: the gateway
    // short-circuits in dry mode, and any fetch that slips through throws.
    process.env.WHATSAPP_MODE = 'dry';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-test-secret';
    process.env.AUTH_SESSION_HOURS = '168';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const existingAudit = await db.orm.public.AuditLog.all();
    preExistingAuditIds = new Set(
      ((Array.isArray(existingAudit) ? existingAudit : []) as AnyRow[]).map((r) => r.id as string),
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'e2e-password' })
      .expect(201);
    authCookie = (loginRes.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  afterAll(async () => {
    // `db` is a singleton owned by PrismaService, so cleanup has to run while
    // the app is still open; app.close() would close the client underneath us.
    //
    // Note: the fluent `.delete()` is only documented for a unique filter
    // (`where({ id })`) and removes just one row for a non-unique one, so
    // every row is addressed by its primary key.
    const removeAll = async (api: any, filter: AnyRow) => {
      const found = await api.where(filter).all();
      for (const row of Array.isArray(found) ? found : []) {
        await api.where({ id: row.id }).delete();
      }
    };

    for (const campaignId of createdCampaigns) {
      await removeAll(db.orm.public.Message, { campaignId });
      await db.orm.public.Campaign.where({ id: campaignId }).delete();
    }
    for (const id of createdCustomers) {
      await db.orm.public.Customer.where({ id }).delete();
    }
    for (const id of createdTemplates) {
      await db.orm.public.MessageTemplate.where({ id }).delete();
    }

    // Prove the suite left no residue in the agency's real data.
    // (Filter in JS: the `where` callback gets a field-builder proxy, not a
    // plain row, so string helpers are not available there.)
    const all = async (api: any): Promise<AnyRow[]> => {
      const found = await api.all();
      return Array.isArray(found) ? found : [];
    };
    const leftovers = (await all(db.orm.public.Campaign)).filter((r) => String(r.name).startsWith(RUN_ID));
    const leftoverMessages = (await all(db.orm.public.Message)).filter((r) => String(r.customerName).startsWith('E2E '));
    const leftoverCustomers = (await all(db.orm.public.Customer)).filter((r) => String(r.name).startsWith('E2E '));
    const leftoverTemplates = (await all(db.orm.public.MessageTemplate)).filter((r) =>
      String(r.name).startsWith(RUN_ID),
    );
    expect([
      leftovers.length,
      leftoverMessages.length,
      leftoverCustomers.length,
      leftoverTemplates.length,
    ]).toEqual([0, 0, 0, 0]);

    // Remove exactly the audit rows these tests created, by primary key.
    const auditRows = await db.orm.public.AuditLog.all();
    for (const row of (Array.isArray(auditRows) ? auditRows : []) as AnyRow[]) {
      if (!preExistingAuditIds.has(row.id)) await db.orm.public.AuditLog.where({ id: row.id }).delete();
    }

    await app.close();
    delete process.env.WHATSAPP_MODE;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_SESSION_HOURS;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      throw new Error('network access is not allowed in the campaign e2e suite');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a campaign end to end against the real database, with DB-backed progress', async () => {
    // --- fixtures -------------------------------------------------------
    const template = await db.orm.public.MessageTemplate
      .create({
        name: `${RUN_ID}-template`,
        body: 'Hello {{customer_name}}',
        description: 'campaign e2e',
        isActive: true,
        metaName: null,
        metaLanguage: 'en',
      })
      .then((t: AnyRow) => t);
    createdTemplates.push(template.id);

    const created = await db.orm.public.Customer.createAll([
      { mobile: '919000000001', name: 'E2E One', variables: null },
      { mobile: '919000000002', name: 'E2E Two', variables: null },
      { mobile: '919000000003', name: 'E2E Three', variables: null },
    ]);
    const customers = Array.isArray(created) ? created : [created];
    createdCustomers.push(...customers.map((c: AnyRow) => c.id));

    // Two campaigns: only the first is ever started. The second proves the
    // engine never reaches across campaign boundaries.
    const runRes = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', authCookie)
      .send({
        name: `${RUN_ID}-running`,
        templateId: createdTemplates[createdTemplates.length - 1],
        customerIds: customers.slice(0, 2).map((c: AnyRow) => c.id),
        throttleMs: 5000,
      })
      .expect(201);

    const otherRes = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', authCookie)
      .send({
        name: `${RUN_ID}-untouched`,
        templateId: createdTemplates[createdTemplates.length - 1],
        customerIds: [customers[2].id],
        throttleMs: 5000,
      })
      .expect(201);

    const runCampaignId = runRes.body.id as string;
    const otherCampaignId = otherRes.body.id as string;
    createdCampaigns.push(runCampaignId, otherCampaignId);

    expect(runRes.body.status).toBe('DRAFT');
    expect(runRes.body.total).toBe(2);
    expect(runRes.body.pending).toBe(2);

    // --- progress before the run is DB-derived, not just stored counters ---
    const before = await request(app.getHttpServer())
      .get(`/campaigns/${runCampaignId}/progress`)
      .set('Cookie', authCookie)
      .expect(200);
    expect(before.body).toEqual({
      campaignId: runCampaignId,
      status: 'DRAFT',
      total: 2,
      sent: 0,
      failed: 0,
      pending: 2,
      percentage: 0,
    });

    // --- start ------------------------------------------------------------
    // Both messages were written by one batch and share a createdAt, so the
    // `id` tiebreaker would govern. Rewrite the timestamps so the *later*
    // recipient is the *earlier* message: the engine must then send it first,
    // proving order comes from createdAt rather than insertion or id.
    const seeded = await db.orm.public.Message.where({ campaignId: runCampaignId }).all();
    const seededRows = Array.isArray(seeded) ? seeded : [];
    expect(seededRows).toHaveLength(2);
    const firstCustomer = seededRows.find((r: AnyRow) => r.customerId === customers[0].id);
    const secondCustomer = seededRows.find((r: AnyRow) => r.customerId === customers[1].id);
    const base = Temporal.Instant.from('2026-01-01T00:00:00Z');
    await db.orm.public.Message.where({ id: firstCustomer.id }).update({
      createdAt: base.add({ minutes: 10 }),
    });
    await db.orm.public.Message.where({ id: secondCustomer.id }).update({
      createdAt: base.add({ minutes: 5 }),
    });

    const startedAt = Date.now();
    await request(app.getHttpServer())
      .post(`/campaigns/${runCampaignId}/start`)
      .set('Cookie', authCookie)
      .expect(201)
      .expect((res) => expect(res.body).toEqual({ ok: true, status: 'RUNNING' }));

    // Starting a RUNNING campaign again is refused and adds no second runner.
    await request(app.getHttpServer())
      .post(`/campaigns/${runCampaignId}/start`)
      .set('Cookie', authCookie)
      .expect(400);

    // --- run to completion -----------------------------------------------
    // The progress endpoint is polled the same way the UI polls it, so this
    // asserts the real numbers a user would see.
    let progress: AnyRow = before.body;
    const readProgress = async () => {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${runCampaignId}/progress`)
        .set('Cookie', authCookie)
        .expect(200);
      progress = res.body;
      return progress.status === 'COMPLETED';
    };

    await until(readProgress);
    const elapsed = Date.now() - startedAt;

    expect(progress).toEqual({
      campaignId: runCampaignId,
      status: 'COMPLETED',
      total: 2,
      sent: 2,
      failed: 0,
      pending: 0,
      percentage: 100,
    });
    // One 5s throttle between the two sends, and none after the last one.
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(9000);

    // --- persisted message rows ------------------------------------------
    const messages = await db.orm.public.Message
      .where({ campaignId: runCampaignId })
      .orderBy((m: AnyRow) => m.createdAt.asc())
      .all();
    const rows = Array.isArray(messages) ? messages : [];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('SENT');
      expect(row.attemptCount).toBe(1);
      expect(row.error).toBeNull();
      expect(row.whatsappId).toBeTruthy();
      expect(String(row.whatsappId)).toMatch(/^dry-/);
      expect(row.sentAt).toBeTruthy();
    }

    // Deterministic order: the row with the older createdAt went first, even
    // though it was the second of the batch.
    expect(rows[0].customerId).toBe(customers[1].id);
    expect(rows[0].content).toBe('Hello E2E Two');
    expect(rows[1].customerId).toBe(customers[0].id);
    expect(rows[1].content).toBe('Hello E2E One');

    // --- campaign row counters match the message rows ----------------------
    const stored = await db.orm.public.Campaign.where({ id: runCampaignId }).first();
    expect(stored).toMatchObject({
      status: 'COMPLETED',
      total: 2,
      sent: 2,
      failed: 0,
      pending: 0,
    });

    // --- campaign ownership ----------------------------------------------
    const foreign = await db.orm.public.Message.where({ campaignId: otherCampaignId }).all();
    const foreignRows = Array.isArray(foreign) ? foreign : [];
    expect(foreignRows).toHaveLength(1);
    expect(foreignRows[0].status).toBe('PENDING');
    expect(foreignRows[0].attemptCount).toBe(0);

    const otherStored = await db.orm.public.Campaign.where({ id: otherCampaignId }).first();
    expect(otherStored).toMatchObject({ status: 'DRAFT', sent: 0, failed: 0, pending: 1 });

    // --- counters for an untouched campaign come from its own rows only ----
    const otherProgress = await request(app.getHttpServer())
      .get(`/campaigns/${otherCampaignId}/progress`)
      .set('Cookie', authCookie)
      .expect(200);
    expect(otherProgress.body).toEqual({
      campaignId: otherCampaignId,
      status: 'DRAFT',
      total: 1,
      sent: 0,
      failed: 0,
      pending: 1,
      percentage: 0,
    });

    // Dry mode means the gateway was never asked to reach Meta.
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);

  it('halts delivery when a running campaign is paused and stopped', async () => {
    const template = await db.orm.public.MessageTemplate
      .create({
        name: `${RUN_ID}-lifecycle`,
        body: 'Hello {{customer_name}}',
        isActive: true,
        metaName: null,
        metaLanguage: 'en',
      })
      .then((t: AnyRow) => t);
    createdTemplates.push(template.id);

    // Two recipients plus a real throttle: after the first send the engine
    // waits, which gives a wide, deterministic window to pause and stop.
    const created = await db.orm.public.Customer.createAll([
      { mobile: '919000000009', name: 'E2E Nine', variables: null },
      { mobile: '919000000010', name: 'E2E Ten', variables: null },
    ]);
    const customers = Array.isArray(created) ? created : [created];
    createdCustomers.push(...customers.map((c: AnyRow) => c.id));

    const res = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Cookie', authCookie)
      .send({
        name: `${RUN_ID}-lifecycle`,
        templateId: template.id,
        customerIds: customers.map((c: AnyRow) => c.id),
        throttleMs: 5000,
      })
      .expect(201);
    const campaignId = res.body.id as string;
    createdCampaigns.push(campaignId);

    const messageRows = async () => {
      const all = await db.orm.public.Message.where({ campaignId }).all();
      const rows = Array.isArray(all) ? all : [];
      return rows.sort((a: AnyRow, b: AnyRow) => String(a.createdAt).localeCompare(String(b.createdAt)));
    };

    // DRAFT: pause, stop and resume are all invalid.
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/pause`).set('Cookie', authCookie).expect(400);
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/stop`).set('Cookie', authCookie).expect(400);
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/resume`).set('Cookie', authCookie).expect(400);

    // DRAFT -> RUNNING is the one valid move.
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/start`)
      .set('Cookie', authCookie)
      .expect(201);

    // Wait for exactly one send to land; the engine is then parked in its 5s
    // throttle, which is the window to pause and stop. Counting instead of
    // indexing keeps this independent of the createdAt tie in the batch.
    await until(async () => (await messageRows()).filter((r: AnyRow) => r.status === 'SENT').length === 1);

    // RUNNING -> PAUSED
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/pause`)
      .set('Cookie', authCookie)
      .expect(201)
      .expect((r) => expect(r.body).toEqual({ ok: true, status: 'PAUSED' }));
    expect(await db.orm.public.Campaign.where({ id: campaignId }).first()).toMatchObject({ status: 'PAUSED' });

    // PAUSED -> STOPPED
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/stop`)
      .set('Cookie', authCookie)
      .expect(201)
      .expect((r) => expect(r.body).toEqual({ ok: true, status: 'STOPPED' }));

    // The throttle that was in flight is abandoned, and the second recipient
    // is never contacted: stopping actually stops.
    await new Promise((r) => setTimeout(r, 300));
    const rows = await messageRows();
    expect(rows).toHaveLength(2);
    const sent = rows.filter((r: AnyRow) => r.status === 'SENT');
    const pending = rows.filter((r: AnyRow) => r.status === 'PENDING');
    expect(sent).toHaveLength(1);
    expect(sent[0].attemptCount).toBe(1);
    expect(pending).toHaveLength(1);
    expect(pending[0].attemptCount).toBe(0);
    // The recipient that was never contacted was never retried either.
    expect(pending[0].whatsappId).toBeNull();

    // Progress reflects the real rows: partially delivered, not complete.
    const progress = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}/progress`)
      .set('Cookie', authCookie)
      .expect(200);
    expect(progress.body).toEqual({
      campaignId,
      status: 'STOPPED',
      total: 2,
      sent: 1,
      failed: 0,
      pending: 1,
      percentage: 50,
    });

    // STOPPED is terminal for this campaign: it cannot be restarted.
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/start`).set('Cookie', authCookie).expect(400);
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/pause`).set('Cookie', authCookie).expect(400);
    await request(app.getHttpServer()).post(`/campaigns/${campaignId}/resume`).set('Cookie', authCookie).expect(400);

    expect((await db.orm.public.Campaign.where({ id: campaignId }).first()).status).toBe('STOPPED');
  }, 30_000);

  it('reports 404 for an unknown campaign and never leaks a body', async () => {
    const res = await request(app.getHttpServer())
      .get('/campaigns/does-not-exist/progress')
      .set('Cookie', authCookie)
      .expect(404);
    expect(res.body.message).toContain('not found');
  });
});
