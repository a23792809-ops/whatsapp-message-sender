import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService, ForbiddenException, ServiceUnavailableException } from '@nestjs/config';
import { WebhooksService, type WebhookProcessResult } from './webhooks.service.js';
import { DeliveryStatus, describeFailure, resolveEventTimestamp, resolveTransition } from './webhooks.types.js';
import { WhatsAppWebhookDto } from './dto/whatsapp-webhook.dto.js';

/* ------------------------------------------------------------------ */
/* Transition policy                                                   */
/* ------------------------------------------------------------------ */

describe('resolveTransition', () => {
  const applied = (current: unknown, incoming: unknown) => resolveTransition(current, incoming);

  it('advances through the normal lifecycle', () => {
    expect(applied(DeliveryStatus.PENDING, DeliveryStatus.SENT).action).toBe('apply');
    expect(applied(DeliveryStatus.SENT, DeliveryStatus.DELIVERED).action).toBe('apply');
    expect(applied(DeliveryStatus.DELIVERED, DeliveryStatus.READ).action).toBe('apply');
    // Skipping a stage is fine: Meta may deliver `read` with no `delivered`.
    expect(applied(DeliveryStatus.SENT, DeliveryStatus.READ).action).toBe('apply');
  });

  it('refuses to downgrade, so an out-of-order event cannot rewind a message', () => {
    expect(applied(DeliveryStatus.READ, DeliveryStatus.DELIVERED).action).toBe('skip');
    expect(applied(DeliveryStatus.DELIVERED, DeliveryStatus.SENT).action).toBe('skip');
    expect(applied(DeliveryStatus.READ, DeliveryStatus.SENT).action).toBe('skip');
  });

  it('treats an exact repeat as a no-op rather than an error', () => {
    for (const s of [DeliveryStatus.SENT, DeliveryStatus.DELIVERED, DeliveryStatus.READ]) {
      expect(applied(s, s).action).toBe('skip');
    }
  });

  it('makes FAILED terminal: nothing can revive a failed message', () => {
    for (const incoming of [DeliveryStatus.SENT, DeliveryStatus.DELIVERED, DeliveryStatus.READ, DeliveryStatus.FAILED]) {
      const decision = applied(DeliveryStatus.FAILED, incoming);
      expect(decision.action).toBe('skip');
      expect(decision.reason).toContain('terminal');
    }
  });

  it('accepts FAILED from any live state', () => {
    for (const current of [DeliveryStatus.PENDING, DeliveryStatus.SENT, DeliveryStatus.DELIVERED, DeliveryStatus.READ]) {
      expect(applied(current, DeliveryStatus.FAILED)).toEqual({ action: 'apply', next: DeliveryStatus.FAILED, reason: `${current} -> FAILED` });
    }
  });

  it('refuses statuses we do not model instead of guessing', () => {
    expect(applied(DeliveryStatus.SENT, 'ACKNOWLEDGED').action).toBe('unsupported');
    expect(applied(DeliveryStatus.SENT, '').action).toBe('unsupported');
    expect(applied(DeliveryStatus.SENT, null).action).toBe('unsupported');
    expect(applied(DeliveryStatus.SENT, undefined).action).toBe('unsupported');
  });

  it('never lets a webhook move a message back to PENDING', () => {
    expect(applied(DeliveryStatus.SENT, DeliveryStatus.PENDING).action).toBe('unsupported');
  });

  it('adopts any known status for a legacy row whose state is unrecognised', () => {
    expect(applied('SOMETHING_LEGACY', DeliveryStatus.DELIVERED).action).toBe('apply');
    expect(applied(null, DeliveryStatus.SENT).action).toBe('apply');
  });

  it('is case and whitespace insensitive on the incoming value', () => {
    expect(applied(DeliveryStatus.SENT, ' read ')).toEqual({
      action: 'apply',
      next: DeliveryStatus.READ,
      reason: 'SENT -> READ',
    });
  });
});

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

describe('resolveEventTimestamp', () => {
  const received = new Date('2026-06-01T12:00:00.000Z');

  it('uses the provider event time when it is plausible', () => {
    const seconds = Math.floor(Date.parse('2026-06-01T11:59:58.000Z') / 1000);
    expect(resolveEventTimestamp(String(seconds), received).toISOString()).toBe('2026-06-01T11:59:58.000Z');
  });

  it('falls back to receipt time when the timestamp is missing or unusable', () => {
    for (const bad of [undefined, null, '', 'not-a-number', '0', -1, NaN, '99999999999999999999']) {
      expect(resolveEventTimestamp(bad, received).toISOString()).toBe(received.toISOString());
    }
  });

  it('rejects implausible dates rather than persisting them', () => {
    // Before WhatsApp existed.
    expect(resolveEventTimestamp(String(Date.UTC(2001, 0, 1) / 1000), received).toISOString()).toBe(received.toISOString());
    // Far in the future: the classic clock-skew symptom.
    const future = Math.floor((received.getTime() + 60 * 60_000) / 1000);
    expect(resolveEventTimestamp(String(future), received).toISOString()).toBe(received.toISOString());
  });

  it('tolerates a small forward skew inside the grace window', () => {
    const near = Math.floor((received.getTime() + 30_000) / 1000);
    expect(resolveEventTimestamp(String(near), received).toISOString()).toBe(new Date(near * 1000).toISOString());
  });

  it('accepts a millisecond value from a gateway that rewrites the unit', () => {
    const ms = Date.parse('2026-06-01T11:59:58.000Z');
    expect(resolveEventTimestamp(String(ms), received).toISOString()).toBe('2026-06-01T11:59:58.000Z');
  });
});

/* ------------------------------------------------------------------ */
/* Failure description                                                 */
/* ------------------------------------------------------------------ */

describe('describeFailure', () => {
  it('keeps the code and a human-readable title', () => {
    const f = describeFailure([{ code: 131047, title: 'Re-engagement message', details: 'More than 24 hours have passed' }]);
    expect(f).not.toBeNull();
    expect(f!.code).toBe(131047);
    expect(f!.text).toContain('131047');
    expect(f!.text).toContain('Re-engagement message');
  });

  it('reads error_data.details and the message field', () => {
    expect(describeFailure([{ code: 1, error_data: { details: 'bad parameter' } }])!.text).toContain('bad parameter');
    expect(describeFailure([{ code: 2, message: 'invalid recipient' }])!.text).toContain('invalid recipient');
  });

  it('redacts credential-shaped text that a provider error might echo back', () => {
    const f = describeFailure([{ code: 5, message: 'rejected bearer abcdef0123456789 and EAAG1234567890123456789012' }])!;
    expect(f.text).not.toContain('abcdef0123456789');
    expect(f.text).not.toContain('EAAG1234567890123456789012');
  });

  it('bounds the length so a verbose error cannot bloat a row', () => {
    const f = describeFailure([{ code: 9, message: 'x'.repeat(5000) }])!;
    expect(f.text.length).toBeLessThanOrEqual(300);
  });

  it('returns null for missing or non-array errors', () => {
    expect(describeFailure(undefined)).toBeNull();
    expect(describeFailure([])).toBeNull();
    expect(describeFailure('nope')).toBeNull();
    expect(describeFailure([null, 'x'])).toBeNull();
  });

  it('still produces usable text when Meta sends no details at all', () => {
    const f = describeFailure([{}])!;
    expect(f.code).toBeNull();
    expect(f.text.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function makeService(env: Record<string, string> = {}, rows: Row[] = []) {
  const store: Row[] = rows;

  const api = {
    where: (filter: Row) => ({
      first: async () => {
        const [key, value] = Object.entries(filter)[0] ?? [];
        if (!key) return null;
        return store.find((r) => r[key] === value) ?? null;
      },
      update: async (patch: Row) => {
        const id = filter.id;
        const row = store.find((r) => r.id === id);
        if (!row) throw new Error('row not found');
        Object.assign(row, patch);
        return row;
      },
    }),
  };

  const prisma = { client: { orm: { public: { Message: api } } } } as any;
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as any;

  return { service: new WebhooksService(prisma, config, audit), store, audit, api };
}

function message(over: Row = {}): Row {
  return {
    id: 'm1',
    campaignId: 'c1',
    status: DeliveryStatus.SENT,
    whatsappId: 'wamid.ABC123',
    sentAt: new Date('2026-06-01T11:00:00.000Z'),
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    error: null,
    errorCode: null,
    ...over,
  };
}

/** A realistic single-status Meta payload. */
function payload(status: string, id: string | undefined = 'wamid.ABC123', errors?: unknown[]): WhatsAppWebhookDto {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              statuses: [{ id, status, timestamp: '1780310400', ...(errors ? { errors } : {}) }],
            },
          },
        ],
      },
    ],
  } as WhatsAppWebhookDto;
}

const sign = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(body)).digest('hex')}`;
const body = (p: unknown) => JSON.stringify(p);

describe('WebhooksService signature policy', () => {
  it('requires a signature whenever an app secret is configured', () => {
    const { service } = makeService({ WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_MODE: 'dry' });
    expect(service.signatureRequired).toBe(true);
  });

  it('fails closed in production even with no app secret', () => {
    const { service } = makeService({ NODE_ENV: 'production', WHATSAPP_MODE: 'dry' });
    expect(service.signatureConfigured).toBe(false);
    expect(service.signatureRequired).toBe(true);
  });

  it('fails closed in live mode even with no app secret', () => {
    const { service } = makeService({ WHATSAPP_MODE: 'live' });
    expect(service.signatureRequired).toBe(true);
  });

  it('is permissive in dry development mode so the feature is testable locally', () => {
    const { service } = makeService({ WHATSAPP_MODE: 'dry' });
    expect(service.signatureRequired).toBe(false);
  });
});

describe('WebhooksService.assertValidSignature', () => {
  const env = { WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_MODE: 'live' };

  it('accepts a correct signature', () => {
    const { service } = makeService(env);
    const raw = Buffer.from(body(payload('delivered')));
    expect(() => service.assertValidSignature(raw, sign(raw.toString()))).not.toThrow();
  });

  it('rejects a missing header', () => {
    const { service } = makeService(env);
    expect(() => service.assertValidSignature(Buffer.from('{}'), undefined)).toThrow(ForbiddenException);
  });

  it('rejects a malformed header', () => {
    const { service } = makeService(env);
    const raw = Buffer.from('{}');
    for (const bad of ['sha1=abc', 'deadbeef', 'sha256=nothex', 'sha256=' + 'a'.repeat(63)]) {
      expect(() => service.assertValidSignature(raw, bad)).toThrow(ForbiddenException);
    }
  });

  it('rejects a signature computed over a different body', () => {
    const { service } = makeService(env);
    const raw = Buffer.from(body(payload('delivered')));
    const other = sign(body(payload('read')));
    expect(() => service.assertValidSignature(raw, other)).toThrow(ForbiddenException);
  });

  it('rejects when the raw body is unavailable, because a signature cannot be checked', () => {
    const { service } = makeService(env);
    expect(() => service.assertValidSignature(undefined, sign('{}'))).toThrow(ForbiddenException);
    expect(() => service.assertValidSignature(Buffer.alloc(0), sign('{}'))).toThrow(ForbiddenException);
  });

  it('skips verification in dry mode, and says so in the config summary', () => {
    const { service } = makeService({ WHATSAPP_MODE: 'dry' });
    expect(() => service.assertValidSignature(undefined, undefined)).not.toThrow();
    expect(service.describeConfiguration()).toMatchObject({
      endpoint: '/webhooks/whatsapp',
      verificationConfigured: false,
      signatureConfigured: false,
      signatureRequired: false,
    });
  });
});

describe('WebhooksService.verifySubscription', () => {
  it('echoes the challenge when the token matches', () => {
    const { service } = makeService({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN });
    expect(service.verifySubscription({ mode: 'subscribe', verifyToken: VERIFY_TOKEN, challenge: '12345' })).toBe('12345');
    expect(service.describeConfiguration().verifiedByMeta).toBe(true);
  });

  it('rejects a wrong token without revealing why', () => {
    const { service } = makeService({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN });
    expect(() => service.verifySubscription({ mode: 'subscribe', verifyToken: 'wrong', challenge: '1' })).toThrow(
      ForbiddenException,
    );
    expect(() => service.verifySubscription({ mode: 'subscribe', challenge: '1' })).toThrow(ForbiddenException);
  });

  it('rejects a missing or unexpected mode', () => {
    const { service } = makeService({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN });
    expect(() => service.verifySubscription({ mode: 'unsubscribe', verifyToken: VERIFY_TOKEN, challenge: '1' })).toThrow(
      ForbiddenException,
    );
    expect(() => service.verifySubscription({ verifyToken: VERIFY_TOKEN, challenge: '1' })).toThrow(ForbiddenException);
  });

  it('reports an unconfigured server distinctly, so operators can act on it', () => {
    const { service } = makeService({});
    expect(() => service.verifySubscription({ mode: 'subscribe', verifyToken: 'x', challenge: '1' })).toThrow(
      ServiceUnavailableException,
    );
  });

  it('does not act as a generic text reflector for a non-numeric challenge', () => {
    const { service } = makeService({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN });
    expect(() =>
      service.verifySubscription({ mode: 'subscribe', verifyToken: VERIFY_TOKEN, challenge: 'hello<script>' }),
    ).toThrow(ForbiddenException);
  });
});

describe('WebhooksService.process', () => {
  const env = { WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_MODE: 'live', WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN };

  it('advances a message and records a single lifecycle timestamp', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    const res = await service.process(payload('delivered'));
    expect(res.applied).toBe(1);
    expect(row.status).toBe(DeliveryStatus.DELIVERED);
    expect(row.deliveredAt).toBeTruthy();
    // A delivery must not invent a read or failure time.
    expect(row.readAt).toBeNull();
    expect(row.failedAt).toBeNull();
  });

  it('keeps the first observation of a timestamp when the same event repeats', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    await service.process(payload('delivered'));
    const first = row.deliveredAt;
    await service.process(payload('delivered'));
    expect(row.deliveredAt).toBe(first);
  });

  it('continues read → further events, and never rewinds to delivered', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    await service.process(payload('read'));
    expect(row.status).toBe(DeliveryStatus.READ);
    const readAt = row.readAt;

    const res = await service.process(payload('delivered'));
    expect(res.ignored).toBe(1);
    expect(res.applied).toBe(0);
    expect(row.status).toBe(DeliveryStatus.READ);
    expect(row.readAt).toBe(readAt);
  });

  it('stores a failure with a bounded, redacted error and no timestamp clobbering', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    const res = await service.process(
      payload('failed', 'wamid.ABC123', [{ code: 131047, title: 'Re-engagement message' }]),
    );
    expect(res.applied).toBe(1);
    expect(row.status).toBe(DeliveryStatus.FAILED);
    expect(row.failedAt).toBeTruthy();
    expect(row.errorCode).toBe(131047);
    expect(row.error).toContain('Re-engagement message');
    expect(row.deliveredAt).toBeNull();
  });

  it('keeps an existing send error when the failure event carries no details', async () => {
    const row = message({ error: 'original send failure' });
    const { service } = makeService(env, [row]);
    await service.process(payload('failed'));
    expect(row.status).toBe(DeliveryStatus.FAILED);
    expect(row.error).toBe('original send failure');
  });

  it('never moves a failed message back to sent', async () => {
    const row = message({ status: DeliveryStatus.FAILED });
    const { service } = makeService(env, [row]);
    const res = await service.process(payload('delivered'));
    expect(res.applied).toBe(0);
    expect(row.status).toBe(DeliveryStatus.FAILED);
  });

  it('handles an unknown message id without throwing, and audits it once per payload', async () => {
    const { service, audit } = makeService(env, [message()]);
    const res = await service.process(payload('delivered', 'wamid.UNKNOWN'));
    expect(res.unknownMessage).toBe(1);
    expect(res.applied).toBe(0);

    const unknownAudits = audit.record.mock.calls.filter(
      (c: any[]) => c[0].action === 'WHATSAPP_STATUS_UNKNOWN_MESSAGE',
    );
    expect(unknownAudits).toHaveLength(1);
  });

  it('ignores an unmodelled future status without touching the row', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    const res = await service.process(payload('acknowledged'));
    expect(res.unsupported).toBe(1);
    expect(res.applied).toBe(0);
    expect(row.status).toBe(DeliveryStatus.SENT);
  });

  it('processes a mixed batch, applying only the valid moves', async () => {
    const a = message({ id: 'm1', whatsappId: 'wamid.A' });
    const b = message({ id: 'm2', whatsappId: 'wamid.B', status: DeliveryStatus.READ });
    const { service } = makeService(env, [a, b]);
    const batch = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'wamid.A', status: 'delivered', timestamp: '1780310400' },
                  { id: 'wamid.B', status: 'delivered', timestamp: '1780310400' },
                  { id: 'wamid.C', status: 'delivered', timestamp: '1780310400' },
                  { id: 'wamid.A', status: 'ignored-status', timestamp: '1780310400' },
                  { status: 'delivered', timestamp: '1780310400' },
                ],
              },
            },
          ],
        },
      ],
    } as WhatsAppWebhookDto;

    const res = await service.process(batch);
    expect(res.received).toBe(5);
    expect(res.applied).toBe(1);
    expect(res.ignored).toBe(1);
    expect(res.unsupported).toBe(1);
    expect(res.unknownMessage).toBe(1);
    expect(res.malformed).toBe(1);
    expect(a.status).toBe(DeliveryStatus.DELIVERED);
    expect(b.status).toBe(DeliveryStatus.READ);
  });

  it('accepts an inbound-message-only payload as a successful no-op', async () => {
    const { service, store } = makeService(env, [message()]);
    const inbound = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                messages: [{ from: '919876543210', id: 'wamid.INBOUND', type: 'text', text: { body: 'hi' } }],
              },
            },
          ],
        },
      ],
    } as WhatsAppWebhookDto;
    const res = await service.process(inbound);
    expect(res).toMatchObject({ received: 0, applied: 0 });
    expect(store[0].status).toBe(DeliveryStatus.SENT);
  });

  it('tolerates an empty or absent entry list', async () => {
    const { service } = makeService(env, [message()]);
    expect(await service.process({} as WhatsAppWebhookDto)).toMatchObject({ received: 0, applied: 0 });
    expect(await service.process({ entry: [] } as WhatsAppWebhookDto)).toMatchObject({ received: 0, applied: 0 });
  });

  it('is idempotent across a redelivered payload, leaving timestamps byte-identical', async () => {
    const row = message();
    const { service } = makeService(env, [row]);
    const p = payload('delivered');
    await service.process(p);
    const snapshot = { ...row };
    const res: WebhookProcessResult = await service.process(p);
    expect(res.applied).toBe(0);
    expect(row).toEqual(snapshot);
  });

  it('matches on whatsappId rather than the message primary key', async () => {
    const row = message({ id: 'unrelated-pk', whatsappId: 'wamid.ABC123' });
    const { service } = makeService(env, [row]);
    await service.process(payload('delivered'));
    expect(row.status).toBe(DeliveryStatus.DELIVERED);
  });
});

describe('WebhooksService audit trail', () => {
  const env = { WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_MODE: 'live' };

  beforeEach(() => vi.clearAllMocks());

  it('never puts the raw payload, a token, or a signature in the audit message', async () => {
    const row = message();
    const { service, audit } = makeService(env, [row]);
    await service.process(payload('delivered'));
    const text = audit.record.mock.calls.map((c: any[]) => JSON.stringify(c[0])).join(' ');
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain('X-Hub-Signature');
    expect(text).not.toContain('messaging_product');
  });

  it('records a rejection on a bad signature', () => {
    const { service, audit } = makeService(env, [message()]);
    expect(() => service.assertValidSignature(Buffer.from('{}'), 'sha256=' + 'a'.repeat(64))).toThrow();
    const rejected = audit.record.mock.calls.filter((c: any[]) => c[0].action === 'WHATSAPP_WEBHOOK_REJECTED');
    expect(rejected.length).toBeGreaterThan(0);
  });
});
