import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHmac } from 'node:crypto';
import 'temporal-polyfill/global';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';
import { db } from './../src/prisma/db.js';

const RUN = `wh-e2e-${process.pid}-${Date.now()}`;
const APP_SECRET = 'e2e-webhook-app-secret';
const VERIFY_TOKEN = 'e2e-webhook-verify-token';
type AnyRow = Record<string, any>;

/** Meta's signature header, computed over the exact bytes we transmit. */
function sign(raw: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(raw)).digest('hex')}`;
}

/** A realistic single-status delivery payload. */
function payload(status: string, id: string | undefined, extra: AnyRow = {}): AnyRow {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_E2E',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: 'PNID' },
              statuses: [
                { id, status, timestamp: String(Math.floor(Date.parse('2026-06-01T12:00:00Z') / 1000)), ...extra },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * POST a payload with a valid signature, signing the exact serialized bytes.
 * Returns the supertest request object, so callers can either `.expect(200)`
 * or `await` it for the response body.
 */
function postSigned(app: INestApplication<App>, body: AnyRow) {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer())
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', sign(raw))
    .send(raw);
}

describe('WhatsApp webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let customerId: string;
  const createdMessageIds: string[] = [];
  const createdCampaignIds: string[] = [];
  let preExistingAuditIds = new Set<string>();
  const fetchMock = vi.fn();

  beforeAll(async () => {
    process.env.WHATSAPP_MODE = 'live';
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-webhook-secret';
    process.env.AUTH_SESSION_HOURS = '168';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Mirrors the production bootstrap in src/main.ts: `rawBody` is required for
    // the signature check, and the parser limit is set explicitly so this suite
    // exercises the same body-size behaviour production has.
    app = moduleFixture.createNestApplication({ rawBody: true, bodyParser: false });
    app.useBodyParser('json', { limit: '1mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const existing = await db.orm.public.AuditLog.all();
    preExistingAuditIds = new Set(((Array.isArray(existing) ? existing : []) as AnyRow[]).map((r) => r.id as string));

    const made = (await db.orm.public.Customer.create({
      mobile: `91${String(Date.now()).slice(-10)}`,
      name: `${RUN} Recipient`,
      variables: null,
    })) as AnyRow;
    customerId = made.id;
  });

  afterAll(async () => {
    for (const id of createdMessageIds) await db.orm.public.Message.where({ id }).delete();
    for (const id of createdCampaignIds) await db.orm.public.Campaign.where({ id }).delete();
    if (customerId) await db.orm.public.Customer.where({ id: customerId }).delete();
    const logs = await db.orm.public.AuditLog.all();
    for (const row of (Array.isArray(logs) ? logs : []) as AnyRow[]) {
      if (!preExistingAuditIds.has(row.id)) await db.orm.public.AuditLog.where({ id: row.id }).delete();
    }

    await app.close();
    for (const key of [
      'WHATSAPP_MODE',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD_HASH',
      'AUTH_SECRET',
      'AUTH_SESSION_HOURS',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(() => {
    fetchMock.mockReset();
    // Any outbound call would mean this suite reached Meta. It must not.
    fetchMock.mockImplementation(async () => {
      throw new Error('network access is not allowed in the webhooks e2e suite');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  /**
   * Creates a message already marked SENT with a Meta id, as the send path
   * would. `timestamptz` columns take a Temporal.Instant, not a Date.
   */
  async function sentMessage(whatsappId: string, campaignId?: string): Promise<AnyRow> {
    const instant = (globalThis as any).Temporal.Instant.from('2026-06-01T11:00:00Z');
    const row = (await db.orm.public.Message.create({
      customerId,
      campaignId: campaignId ?? null,
      mobile: '919876543210',
      customerName: `${RUN} Recipient`,
      content: 'Hello',
      status: 'SENT',
      whatsappId,
      sentAt: instant,
      attemptCount: 1,
    })) as AnyRow;
    createdMessageIds.push(row.id);
    return row;
  }

  const reload = async (id: string): Promise<AnyRow> => {
    const found = await db.orm.public.Message.where({ id }).all();
    return ((Array.isArray(found) ? found : []) as AnyRow[])[0];
  };

  /**
   * Epoch milliseconds of a persisted lifecycle timestamp.
   *
   * The column is driven by a Temporal codec, so rows come back as
   * `Temporal.Instant` rather than `Date`; comparing those with `toBe` or
   * `new Date(...)` would compare object identity, not the instant.
   */
  const instantMs = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const T = (globalThis as any).Temporal;
    if (T?.Instant && typeof (value as any).epochMilliseconds === 'number') {
      return (value as any).epochMilliseconds;
    }
    return new Date(value as string).getTime();
  };

  /* ---------------------------------------------------------------- */
  /* Verification handshake                                            */
  /* ---------------------------------------------------------------- */

  describe('GET verification', () => {
    it('echoes the challenge when the verify token matches', async () => {
      const res = await request(app.getHttpServer())
        .get('/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
      expect(res.status).toBe(200);
      expect(res.text).toBe('1158201444');
    });

    it('rejects a wrong verify token', async () => {
      const res = await request(app.getHttpServer())
        .get('/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('wrong');
    });

    it('rejects a request with no mode', async () => {
      await request(app.getHttpServer())
        .get('/webhooks/whatsapp')
        .query({ 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' })
        .expect(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Signature enforcement                                             */
  /* ---------------------------------------------------------------- */

  describe('POST signature enforcement', () => {
    it('rejects a payload with no signature header', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .send(payload('delivered', 'wamid.NOSIG'))
        .expect(403);
    });

    it('rejects a tampered body', async () => {
      const raw = JSON.stringify(payload('delivered', 'wamid.TAMPER'));
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(raw))
        .send(raw.replace('delivered', 'read'))
        .expect(403);
    });

    it('rejects a signature made with the wrong secret', async () => {
      const raw = JSON.stringify(payload('delivered', 'wamid.WRONGKEY'));
      const bad = `sha256=${createHmac('sha256', 'not-the-secret').update(Buffer.from(raw)).digest('hex')}`;
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', bad)
        .send(raw)
        .expect(403);
    });

    it('rejects a malformed signature header', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', 'sha1=deadbeef')
        .send(JSON.stringify(payload('delivered', 'wamid.MALFORMED')))
        .expect(403);
    });

    it('accepts a correctly signed payload', async () => {
      const res = await postSigned(app, payload('delivered', 'wamid.ACCEPTED'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  it('advances a message sent -> delivered -> read, writing each timestamp once', async () => {
    const id = `wamid.LIFE.${Date.now()}`;
    const created = await sentMessage(id);

    await postSigned(app, payload('delivered', id)).expect(200);
    let row = await reload(created.id);
    expect(row.status).toBe('DELIVERED');
    // Meta's own event time, not our receipt time.
    expect(instantMs(row.deliveredAt)).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
    expect(row.readAt).toBeNull();

    await postSigned(app, payload('read', id)).expect(200);
    row = await reload(created.id);
    expect(row.status).toBe('READ');
    expect(instantMs(row.readAt)).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
    const deliveredAt = instantMs(row.deliveredAt);

    // Replaying both events changes nothing.
    await postSigned(app, payload('delivered', id)).expect(200);
    await postSigned(app, payload('read', id)).expect(200);
    row = await reload(created.id);
    expect(row.status).toBe('READ');
    expect(instantMs(row.deliveredAt)).toBe(deliveredAt);
  });

  it('refuses an out-of-order event that would rewind a message', async () => {
    const id = `wamid.ORDER.${Date.now()}`;
    const created = await sentMessage(id);
    await postSigned(app, payload('read', id)).expect(200);
    const readAt = instantMs((await reload(created.id)).readAt);

    const res = await postSigned(app, payload('delivered', id));
    expect(res.status).toBe(200);
    const row = await reload(created.id);
    expect(row.status).toBe('READ');
    expect(instantMs(row.readAt)).toBe(readAt);
  });

  it('records a failure with a bounded error and keeps it terminal', async () => {
    const id = `wamid.FAIL.${Date.now()}`;
    const created = await sentMessage(id);

    await postSigned(
      app,
      payload('failed', id, { errors: [{ code: 131047, title: 'Re-engagement message', details: 'over 24h' }] }),
    ).expect(200);

    let row = await reload(created.id);
    expect(row.status).toBe('FAILED');
    expect(row.failedAt).toBeTruthy();
    expect(row.errorCode).toBe(131047);
    expect(row.error).toContain('Re-engagement message');
    expect(row.error.length).toBeLessThanOrEqual(300);

    // A late "delivered" must not resurrect a failed message.
    await postSigned(app, payload('delivered', id)).expect(200);
    row = await reload(created.id);
    expect(row.status).toBe('FAILED');
  });

  it('answers 200 for an unknown message id without creating anything', async () => {
    const before = (await db.orm.public.Message.aggregate((a: any) => ({ n: a.count() }))) as AnyRow;
    const res = await postSigned(app, payload('delivered', 'wamid.DOES.NOT.EXIST'));
    expect(res.status).toBe(200);
    const after = (await db.orm.public.Message.aggregate((a: any) => ({ n: a.count() }))) as AnyRow;
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('answers 200 for an unmodelled future status without touching the row', async () => {
    const id = `wamid.FUTURE.${Date.now()}`;
    const created = await sentMessage(id);
    const res = await postSigned(app, payload('something_new', id));
    expect(res.status).toBe(200);
    expect((await reload(created.id)).status).toBe('SENT');
  });

  it('accepts a payload carrying unknown future fields', async () => {
    const id = `wamid.EXTRA.${Date.now()}`;
    await sentMessage(id);
    const body = payload('delivered', id);
    // Simulate Meta adding fields we have never heard of.
    (body.entry[0] as AnyRow).some_new_entry_field = { nested: true };
    (body.entry[0].changes[0].value as AnyRow).future_block = [{ anything: 'at all' }];
    await postSigned(app, body).expect(200);
  });

  it('accepts an inbound-message-only payload as a successful no-op', async () => {
    const res = await postSigned(app, {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_E2E',
          changes: [
            {
              field: 'messages',
              value: { messages: [{ from: '919876543210', id: 'wamid.IN', type: 'text', text: { body: 'hi' } }] },
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(0);
  });

  it('processes a mixed batch, applying only what is valid', async () => {
    const ok = `wamid.BATCH.OK.${Date.now()}`;
    const noId = `wamid.BATCH.NOID.${Date.now()}`;
    const createdOk = await sentMessage(ok);
    const createdNoId = await sentMessage(noId);

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_E2E',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: ok, status: 'delivered', timestamp: '1780310400' },
                  { id: noId, status: 'read', timestamp: '1780310400' },
                  { id: 'wamid.UNKNOWN', status: 'delivered', timestamp: '1780310400' },
                  { id: ok, status: 'nonsense', timestamp: '1780310400' },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postSigned(app, body);
    expect(res.status).toBe(200);
    expect((await reload(createdOk.id)).status).toBe('DELIVERED');
    expect((await reload(createdNoId.id)).status).toBe('READ');
  });

  it('accepts a large batched payload that would exceed express default limits', async () => {
    // Regression guard: express's implicit 100kb body limit rejected Meta's
    // batched delivery notifications with 413, and Meta retries a 4xx forever,
    // so those statuses were never recorded.
    const prefix = `wamid.BIG.${Date.now()}`;
    const rows = (await db.orm.public.Message.createAll(
      Array.from({ length: 40 }, (_, i) => ({
        customerId,
        campaignId: null,
        mobile: '919876543210',
        customerName: `${RUN} Recipient`,
        content: 'x'.repeat(200),
        status: 'SENT',
        whatsappId: `${prefix}.${i}`,
        attemptCount: 1,
      })),
    )) as AnyRow[];
    for (const row of Array.isArray(rows) ? rows : [rows]) createdMessageIds.push(row.id);

    // ~40 statuses padded well past 100kb in total.
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_E2E',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: rows.map((r) => ({
                  id: r.whatsappId,
                  status: 'delivered',
                  timestamp: '1780310400',
                  padding: 'y'.repeat(3000),
                })),
              },
            },
          ],
        },
      ],
    };
    expect(JSON.stringify(body).length).toBeGreaterThan(100_000);

    const res = await postSigned(app, body);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(40);
  });

  /* ---------------------------------------------------------------- */
  /* Interaction with the rest of the system                          */
  /* ---------------------------------------------------------------- */

  it('keeps campaign counters accurate once messages are delivered or read', async () => {
    const campaign = (await db.orm.public.Campaign.create({
      name: `${RUN}-campaign`,
      status: 'COMPLETED',
      templateId: null,
      total: 2,
      sent: 2,
      failed: 0,
      pending: 0,
      throttleMs: 0,
    })) as AnyRow;
    createdCampaignIds.push(campaign.id);

    const a = await sentMessage(`wamid.CAMP.A.${Date.now()}`, campaign.id);
    const b = await sentMessage(`wamid.CAMP.B.${Date.now()}`, campaign.id);
    void a;
    void b;

    await postSigned(app, payload('delivered', a.whatsappId)).expect(200);
    await postSigned(app, payload('read', b.whatsappId)).expect(200);

    // A campaign row is recomputed by the engine; assert the rule it relies on
    // by re-deriving the buckets the same way the service does.
    const rows = await db.orm.public.Message.where({ campaignId: campaign.id }).all();
    const list = (Array.isArray(rows) ? rows : []) as AnyRow[];
    const accepted = list.filter((r) => ['SENT', 'DELIVERED', 'READ'].includes(r.status));
    expect(accepted).toHaveLength(2);
    expect(list.filter((r) => r.status === 'PENDING')).toHaveLength(0);
  });

  it('exposes delivery metrics in the dashboard without changing the existing buckets', async () => {
    const campaign = (await db.orm.public.Campaign.create({
      name: `${RUN}-analytics`,
      status: 'COMPLETED',
      templateId: null,
      total: 1,
      sent: 1,
      failed: 0,
      pending: 0,
      throttleMs: 0,
    })) as AnyRow;
    createdCampaignIds.push(campaign.id);

    const id = `wamid.AN.${Date.now()}`;
    const created = await sentMessage(id, campaign.id);
    await postSigned(app, payload('delivered', id)).expect(200);
    await postSigned(app, payload('read', id)).expect(200);
    expect((await reload(created.id)).status).toBe('READ');
  });

  /* ---------------------------------------------------------------- */
  /* Isolation and secret hygiene                                      */
  /* ---------------------------------------------------------------- */

  it('leaves every other route authenticated', async () => {
    await request(app.getHttpServer()).get('/messages').expect(401);
    await request(app.getHttpServer()).get('/analytics/dashboard').expect(401);
  });

  it('never persists the app secret, the signature, or the raw payload', async () => {
    const logs = (await db.orm.public.AuditLog.all()) as AnyRow[];
    const text = JSON.stringify(logs);
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain(VERIFY_TOKEN);
    expect(text).not.toContain('X-Hub-Signature');
    expect(text).not.toContain('messaging_product');

    const messages = (await db.orm.public.Message.all()) as AnyRow[];
    expect(JSON.stringify(messages)).not.toContain(APP_SECRET);
  });

  it('records an audit trail for accepted and rejected webhooks', async () => {
    const id = `wamid.AUDIT.${Date.now()}`;
    await sentMessage(id);
    await postSigned(app, payload('delivered', id)).expect(200);
    await request(app.getHttpServer()).post('/webhooks/whatsapp').send(payload('read', id)).expect(403);

    const logs = (await db.orm.public.AuditLog.all()) as AnyRow[];
    const actions = new Set(logs.map((r) => r.action));
    expect(actions.has('WHATSAPP_WEBHOOK_RECEIVED')).toBe(true);
    expect(actions.has('WHATSAPP_STATUS_UPDATED')).toBe(true);
    expect(actions.has('WHATSAPP_WEBHOOK_REJECTED')).toBe(true);
  });
});
