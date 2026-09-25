import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignsService } from './campaigns.service.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

const TEMPLATE_BODY = 'Hello {{customer_name}}';

type SendResult = { ok: boolean; whatsappId?: string; error?: unknown };

type Harness = {
  svc: CampaignsService;
  wa: { sendText: ReturnType<typeof vi.fn>; sendTemplate: ReturnType<typeof vi.fn> };
  templates: { getById: ReturnType<typeof vi.fn> };
  campaigns: Row[];
  messages: Row[];
  customers: Row[];
  /** Wall-clock timestamp of every sendText/sendTemplate call, in order. */
  sendTimes: number[];
};

function harness(options: {
  campaigns?: Row[];
  messages?: Row[];
  customers?: Row[];
  send?: () => Promise<SendResult>;
  body?: string;
  metaName?: string | null;
}): Harness {
  const campaigns = options.campaigns ?? [];
  const messages = options.messages ?? [];
  const customers = options.customers ?? [];
  const sendTimes: number[] = [];

  const record = async (mobile: string): Promise<SendResult> => {
    sendTimes.push(Date.now());
    return (options.send?.() ?? { ok: true, whatsappId: `wam-${mobile}` }) as SendResult;
  };

  const template = {
    id: 't1',
    body: options.body ?? TEMPLATE_BODY,
    metaName: options.metaName ?? null,
    metaLanguage: 'en',
  };

  const wa = {
    sendText: vi.fn(async (mobile: string) => record(mobile)),
    sendTemplate: vi.fn(async (mobile: string) => record(mobile)),
  };
  const templates = { getById: vi.fn(async () => template) };
  const prisma = { client: makeOrm({ Campaign: campaigns, Message: messages, Customer: customers }) };
  const svc = new CampaignsService(prisma as any, wa as any, templates as any);

  return { svc, wa, templates, campaigns, messages, customers, sendTimes };
}

let seq = 0;
function campaign(overrides: Row = {}): Row {
  seq += 1;
  return {
    id: `c${seq}`,
    name: 'Campaign',
    status: 'DRAFT',
    templateId: 't1',
    throttleMs: 5,
    total: 1,
    sent: 0,
    failed: 0,
    pending: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let msgSeq = 0;
function message(campaignId: string, overrides: Row = {}): Row {
  msgSeq += 1;
  const n = msgSeq;
  return {
    id: `m${n}`,
    campaignId,
    customerId: `cu${n}`,
    mobile: `9198765432${String(n).padStart(2, '0')}`,
    customerName: `Customer ${n}`,
    content: '',
    status: 'PENDING',
    attemptCount: 0,
    error: null,
    createdAt: `2026-01-01T00:00:0${n % 10}Z`,
    ...overrides,
  };
}

function customer(id: string, overrides: Row = {}): Row {
  return { id, mobile: `9198765432${id.slice(-2)}`, name: `Customer ${id}`, variables: null, ...overrides };
}

async function until(fn: () => boolean, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeout) throw new Error('condition was not reached in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Let the runner settle without asserting on it. */
async function settle(ms = 120) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForIdle(h: Harness, campaignId: string) {
  await until(() => (h.svc as any).engines.get(campaignId)?.running === false);
}

function runnerCount(h: Harness, campaignId: string): number {
  const engines: Map<string, { running: boolean }> = (h.svc as any).engines;
  return engines.get(campaignId)?.running ? 1 : 0;
}

beforeEach(() => {
  seq = 0;
  msgSeq = 0;
});

/** Best-effort cleanup: a campaign that finished on its own cannot be stopped. */
async function stopIfActive(h: Harness, campaignId: string) {
  await h.svc.stop(campaignId).catch(() => undefined);
}

describe('campaign start', () => {
  it('1. starts a valid DRAFT campaign and processes its messages', async () => {
    const c = campaign();
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
    });

    const result = await h.svc.start(c.id);

    expect(result).toEqual({ ok: true, status: 'RUNNING' });
    expect(c.status).toBe('RUNNING');

    await waitForIdle(h, c.id);

    expect(h.wa.sendText).toHaveBeenCalledTimes(1);
    expect(h.messages[0].status).toBe('SENT');
    expect(c.status).toBe('COMPLETED');
  });

  it('2. refuses to start an already-running campaign without spawning a second runner', async () => {
    const c = campaign({ throttleMs: 60, total: 3, pending: 3 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
    });

    await h.svc.start(c.id);
    expect(c.status).toBe('RUNNING');
    expect(runnerCount(h, c.id)).toBe(1);

    // A second start while the campaign is already RUNNING.
    await expect(h.svc.start(c.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(runnerCount(h, c.id)).toBe(1);
    expect(c.status).toBe('RUNNING');

    await until(() => h.wa.sendText.mock.calls.length >= 1);
    const targets = h.wa.sendText.mock.calls.map((call) => call[0]);
    // Exactly one runner is delivering: no recipient is sent twice.
    expect(new Set(targets).size).toBe(targets.length);

    await settle(150);
    const after = h.wa.sendText.mock.calls.map((call) => call[0]);
    expect(new Set(after).size).toBe(after.length);

    await stopIfActive(h, c.id);
  });

  it('rejects start for a campaign that is not startable', async () => {
    for (const status of ['STOPPED', 'COMPLETED', 'FAILED']) {
      const c = campaign({ status });
      const h = harness({ campaigns: [c], messages: [], customers: [] });
      await expect(h.svc.start(c.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(c.status).toBe(status);
    }
  });

  it('throws NotFound for an unknown campaign', async () => {
    const h = harness({});
    await expect(h.svc.start('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('campaign state machine', () => {
  it('allows only the documented transitions', async () => {
    // A campaign with a parked runner: start/resume stay RUNNING instead of
    // racing straight through to COMPLETED.
    const build = (status: string) => {
      const c = campaign({ status, throttleMs: 60_000, total: 1, pending: 1 });
      const h = harness({ campaigns: [c], messages: [message(c.id)], customers: [customer('cu1')] });
      return { c, h };
    };

    const cases: Array<[Row, Harness, () => Promise<unknown>, string]> = [];

    // DRAFT -> RUNNING
    {
      const { c, h } = build('DRAFT');
      cases.push([c, h, () => h.svc.start(c.id), 'RUNNING']);
    }
    // RUNNING -> PAUSED
    {
      const { c, h } = build('RUNNING');
      cases.push([c, h, () => h.svc.pause(c.id), 'PAUSED']);
    }
    // PAUSED -> RUNNING
    {
      const { c, h } = build('PAUSED');
      cases.push([c, h, () => h.svc.resume(c.id), 'RUNNING']);
    }
    // RUNNING -> STOPPED
    {
      const { c, h } = build('RUNNING');
      cases.push([c, h, () => h.svc.stop(c.id), 'STOPPED']);
    }
    // PAUSED -> STOPPED
    {
      const { c, h } = build('PAUSED');
      cases.push([c, h, () => h.svc.stop(c.id), 'STOPPED']);
    }
    // RUNNING -> COMPLETED and RUNNING -> FAILED are driven by the runner and
    // covered in the "message processing" and "engine faults" suites.

    for (const [c, h, act, expected] of cases) {
      const result = (await act()) as { status: string };
      expect(result.status).toBe(expected);
      expect(c.status).toBe(expected);
      // Do not leave a 60s-throttled runner behind.
      if (c.status === 'RUNNING') await h.svc.stop(c.id);
    }
  });

  it('rejects nonsensical transitions', async () => {
    const scenarios: Array<[string, (c: Row, h: Harness) => Promise<unknown>]> = [
      ['DRAFT', (c, h) => h.svc.pause(c.id)],
      ['DRAFT', (c, h) => h.svc.stop(c.id)],
      ['DRAFT', (c, h) => h.svc.resume(c.id)],
      ['PAUSED', (c, h) => h.svc.pause(c.id)],
      ['RUNNING', (c, h) => h.svc.resume(c.id)],
      ['STOPPED', (c, h) => h.svc.start(c.id)],
      ['STOPPED', (c, h) => h.svc.pause(c.id)],
      ['COMPLETED', (c, h) => h.svc.start(c.id)],
      ['COMPLETED', (c, h) => h.svc.stop(c.id)],
      ['FAILED', (c, h) => h.svc.resume(c.id)],
    ];

    for (const [status, act] of scenarios) {
      const c = campaign({ status });
      const h = harness({ campaigns: [c], messages: [], customers: [] });
      await expect(act(c, h)).rejects.toBeInstanceOf(BadRequestException);
      expect(c.status).toBe(status);
    }
  });
});

describe('pause, resume and stop', () => {
  it('3. pause prevents any further sends', async () => {
    const c = campaign({ throttleMs: 40, total: 4, pending: 4 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3'), customer('cu4')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);

    await h.svc.pause(c.id);
    expect(c.status).toBe('PAUSED');

    const sendsAtPause = h.wa.sendText.mock.calls.length;
    await settle(200);

    // No send happened after the pause, and progress is preserved.
    expect(h.wa.sendText.mock.calls.length).toBe(sendsAtPause);
    expect(c.status).toBe('PAUSED');
    expect(h.messages.filter((m) => m.status === 'SENT').length).toBeGreaterThanOrEqual(1);
    expect(h.messages.some((m) => m.status === 'PENDING')).toBe(true);

    await waitForIdle(h, c.id);
  });

  it('4. resume continues the remaining PENDING messages without resending SENT ones', async () => {
    const c = campaign({ throttleMs: 40, total: 3, pending: 3 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);
    await h.svc.pause(c.id);
    await waitForIdle(h, c.id);

    const sentBefore = h.messages.filter((m) => m.status === 'SENT').map((m) => m.mobile);
    expect(sentBefore.length).toBeGreaterThanOrEqual(1);

    await h.svc.resume(c.id);
    expect(c.status).toBe('RUNNING');
    await waitForIdle(h, c.id);

    expect(c.status).toBe('COMPLETED');
    expect(h.messages.every((m) => m.status === 'SENT')).toBe(true);

    // Each recipient received exactly one message overall.
    const targets = h.wa.sendText.mock.calls.map((call) => call[0]);
    expect(new Set(targets).size).toBe(targets.length);

    // Resume did not reset the attempt budget of anything already delivered.
    for (const m of h.messages) expect(m.attemptCount).toBe(1);
  });

  it('resume immediately after pause is not rejected as already running', async () => {
    const c = campaign({ throttleMs: 40, total: 3, pending: 3 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);

    // No settle() here: resume races the old loop on purpose.
    await h.svc.pause(c.id);
    await expect(h.svc.resume(c.id)).resolves.toEqual({ ok: true, status: 'RUNNING' });

    await waitForIdle(h, c.id);
    expect(runnerCount(h, c.id)).toBe(0);
    expect(c.status).toBe('COMPLETED');
  });

  it('5. stop prevents further sends and preserves completed message state', async () => {
    const c = campaign({ throttleMs: 40, total: 4, pending: 4 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3'), customer('cu4')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);

    await h.svc.stop(c.id);
    expect(c.status).toBe('STOPPED');

    const snapshot = h.messages.map((m) => ({ id: m.id, status: m.status, attemptCount: m.attemptCount }));
    const sendsAtStop = h.wa.sendText.mock.calls.length;

    await settle(200);

    expect(h.wa.sendText.mock.calls.length).toBe(sendsAtStop);
    expect(c.status).toBe('STOPPED');
    // Nothing was deleted and no finished message changed.
    expect(h.messages).toHaveLength(4);
    for (const before of snapshot) {
      const after = h.messages.find((m) => m.id === before.id)!;
      if (before.status === 'SENT') {
        expect(after.status).toBe('SENT');
        expect(after.attemptCount).toBe(before.attemptCount);
      }
    }

    await waitForIdle(h, c.id);
  });

  it('pause and stop are interruptible: they do not wait out the throttle', async () => {
    const c = campaign({ throttleMs: 5000, total: 2, pending: 2 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);

    // The runner is now parked in a 5s throttle sleep.
    const started = Date.now();
    await h.svc.pause(c.id);
    expect(Date.now() - started).toBeLessThan(1000);
    await waitForIdle(h, c.id);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('message processing and counters', () => {
  it('6. a successful send updates the message and the campaign correctly', async () => {
    const c = campaign();
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.messages[0]).toMatchObject({
      status: 'SENT',
      content: 'Hello Customer 1',
      whatsappId: 'wam-919876543201',
      error: null,
      attemptCount: 1,
    });
    expect(h.messages[0].sentAt).toBeTruthy();
    expect(c).toMatchObject({ status: 'COMPLETED', total: 1, sent: 1, failed: 0, pending: 0 });
  });

  it('7. a failed send increments the attempt count and keeps the message retryable', async () => {
    const c = campaign({ throttleMs: 5 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
      send: async () => ({ ok: false, error: { httpStatus: 500, code: 1, message: 'Meta unavailable' } }),
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.messages[0].attemptCount).toBe(3);
    expect(h.messages[0].status).toBe('FAILED');
    // The stored error is a short, storable string, not the raw API payload.
    expect(h.messages[0].error).toBe('http=500 code=1 Meta unavailable');
    expect(c).toMatchObject({ status: 'COMPLETED', total: 1, sent: 0, failed: 1, pending: 0 });
  });

  it('8. retry stops at exactly 3 attempts', async () => {
    const c = campaign({ throttleMs: 5 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
      send: async () => ({ ok: false, error: 'always down' }),
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.wa.sendText).toHaveBeenCalledTimes(3);
    expect(h.messages[0].attemptCount).toBe(3);
    expect(h.messages[0].status).toBe('FAILED');
  });

  it('8b. a PENDING message that already used its budget is retired without calling WhatsApp', async () => {
    const c = campaign({ throttleMs: 5 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id, { status: 'PENDING', attemptCount: 3, error: 'previous failure' })],
      customers: [customer('cu1')],
      send: async () => ({ ok: true }),
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.wa.sendText).not.toHaveBeenCalled();
    expect(h.messages[0].status).toBe('FAILED');
    expect(h.messages[0].attemptCount).toBe(3);
    expect(c).toMatchObject({ status: 'COMPLETED', failed: 1, pending: 0 });
  });

  it('8c. a missing template variable fails the message without spending an attempt or sending', async () => {
    const c = campaign({ throttleMs: 5 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
      body: 'Hi {{customer_name}}, order {{order_id}}',
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.wa.sendText).not.toHaveBeenCalled();
    expect(h.messages[0].status).toBe('FAILED');
    expect(h.messages[0].attemptCount).toBe(0);
    expect(h.messages[0].error).toContain('order_id');
    expect(c).toMatchObject({ status: 'COMPLETED', sent: 0, failed: 1, pending: 0 });
  });

  it('9. successful messages are never resent', async () => {
    const c = campaign({ throttleMs: 5, total: 3, pending: 2 });
    const alreadySent = message(c.id, {
      status: 'SENT',
      attemptCount: 1,
      content: 'Hello Customer 1',
      whatsappId: 'wam-existing',
    });
    const h = harness({
      campaigns: [c],
      messages: [alreadySent, message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    const targets = h.wa.sendText.mock.calls.map((call) => call[0]);
    expect(targets).not.toContain(alreadySent.mobile);
    expect(targets).toHaveLength(2);
    // The pre-existing SENT row is untouched.
    expect(alreadySent.whatsappId).toBe('wam-existing');
    expect(alreadySent.attemptCount).toBe(1);
    expect(c).toMatchObject({ status: 'COMPLETED', total: 3, sent: 3, failed: 0, pending: 0 });
  });

  it('10. completes when no processable messages remain and never reports failures as sent', async () => {
    const c = campaign({ throttleMs: 5, total: 3, pending: 3 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
      send: async () => ({ ok: false, error: 'nope' }),
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(c.status).toBe('COMPLETED');
    expect(c.sent).toBe(0);
    expect(c.failed).toBe(3);
    expect(c.pending).toBe(0);
    expect(h.wa.sendText).toHaveBeenCalledTimes(9);
  });

  it('11. progress reflects the actual message rows, not stored counters', async () => {
    const c = campaign({ status: 'RUNNING', total: 99, sent: 42, failed: 7, pending: 50 });
    const h = harness({
      campaigns: [c],
      messages: [
        message(c.id, { status: 'SENT', attemptCount: 1 }),
        message(c.id, { status: 'SENT', attemptCount: 1 }),
        message(c.id, { status: 'SENT', attemptCount: 1 }),
        message(c.id, { status: 'FAILED', attemptCount: 3, error: 'boom' }),
        message(c.id, { status: 'PENDING' }),
      ],
      customers: [customer('cu1')],
    });

    // Stored counters are deliberately wrong; progress must ignore them.
    const progress = await h.svc.progress(c.id);

    expect(progress).toEqual({
      campaignId: c.id,
      status: 'RUNNING',
      total: 5,
      sent: 3,
      failed: 1,
      pending: 1,
      percentage: 80,
    });
  });

  it('progress is accurate for a campaign whose messages all failed', async () => {
    const c = campaign({ status: 'COMPLETED' });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id, { status: 'FAILED', attemptCount: 3 }), message(c.id, { status: 'FAILED', attemptCount: 3 })],
      customers: [],
    });

    const progress = await h.svc.progress(c.id);
    expect(progress).toMatchObject({ status: 'COMPLETED', total: 2, sent: 0, failed: 2, pending: 0, percentage: 100 });
  });

  it('processes messages in createdAt order and only its own campaign', async () => {
    const c = campaign({ throttleMs: 5, total: 2, pending: 2 });
    const other = campaign({ status: 'RUNNING', total: 1, pending: 1 });
    const h = harness({
      campaigns: [c, other],
      messages: [
        message(c.id, { id: 'late', createdAt: '2026-01-02T00:00:00Z' }),
        message(c.id, { id: 'early', createdAt: '2026-01-01T00:00:00Z' }),
        message(other.id, { id: 'foreign', createdAt: '2026-01-01T00:00:00Z' }),
      ],
      customers: [customer('cu1'), customer('cu2'), customer('cu3')],
    });

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    const targets = h.wa.sendText.mock.calls.map((call) => call[0]);
    const early = h.messages.find((m) => m.id === 'early')!.mobile;
    const late = h.messages.find((m) => m.id === 'late')!.mobile;
    const foreign = h.messages.find((m) => m.id === 'foreign')!.mobile;

    expect(targets).toEqual([early, late]);
    expect(targets).not.toContain(foreign);
    // The other campaign's message was never touched.
    expect(h.messages.find((m) => m.id === 'foreign')!.status).toBe('PENDING');
    expect(other.sent).toBe(0);
    expect(other.pending).toBe(1);
  });
});

describe('throttling', () => {
  it('waits the campaign throttle between sends but not after the final one', async () => {
    const throttleMs = 150;
    const c = campaign({ throttleMs, total: 2, pending: 2 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2')],
    });

    const startedAt = Date.now();
    await h.svc.start(c.id);
    await waitForIdle(h, c.id);
    const elapsed = Date.now() - startedAt;

    expect(h.sendTimes).toHaveLength(2);
    const gap = h.sendTimes[1] - h.sendTimes[0];
    // The throttle is honoured between the two attempts.
    expect(gap).toBeGreaterThanOrEqual(throttleMs - 20);
    // No throttle is paid after the last send, so finishing costs one gap, not two.
    expect(elapsed).toBeLessThan(throttleMs * 2);
  });

  it('does not delay a loop that has no send left to make', async () => {
    const c = campaign({ throttleMs: 5000 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id)],
      customers: [customer('cu1')],
    });

    const startedAt = Date.now();
    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    expect(h.wa.sendText).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('defaults to a 19s throttle when the campaign has none', async () => {
    const c = campaign({ throttleMs: 0, total: 2, pending: 2 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2')],
    });

    await h.svc.start(c.id);
    await until(() => h.wa.sendText.mock.calls.length >= 1);

    // The second send must still be pending because 19s has not elapsed.
    await settle(150);
    expect(h.wa.sendText).toHaveBeenCalledTimes(1);

    await stopIfActive(h, c.id);
  });
});

describe('retry endpoint', () => {
  it('re-queues failed messages for a fresh attempt budget without touching SENT ones', async () => {
    const c = campaign({ status: 'COMPLETED', total: 2, sent: 1, failed: 1, pending: 0 });
    const sent = message(c.id, { status: 'SENT', attemptCount: 1, whatsappId: 'wam-1' });
    const failed = message(c.id, { status: 'FAILED', attemptCount: 3, error: 'boom' });
    const h = harness({
      campaigns: [c],
      messages: [sent, failed],
      customers: [customer('cu1'), customer('cu2')],
    });

    const result = await h.svc.retryFailed(c.id);

    expect(result).toEqual({ ok: true, retried: 1 });
    expect(failed).toMatchObject({ status: 'PENDING', attemptCount: 0, error: null });
    expect(sent.status).toBe('SENT');
    expect(c.status).toBe('QUEUED');
    expect(c).toMatchObject({ sent: 1, failed: 0, pending: 1, total: 2 });
  });

  it('does not move a RUNNING campaign back to QUEUED', async () => {
    const c = campaign({ throttleMs: 40, total: 2, pending: 2 });
    const h = harness({
      campaigns: [c],
      messages: [message(c.id), message(c.id)],
      customers: [customer('cu1'), customer('cu2')],
    });

    await h.svc.start(c.id);
    // Fail the first message, then re-queue it while the runner is live.
    h.messages[0].status = 'FAILED';
    h.messages[0].attemptCount = 3;

    const result = await h.svc.retryFailed(c.id);
    expect(result.retried).toBe(1);
    expect(c.status).toBe('RUNNING');

    await stopIfActive(h, c.id);
  });

  it('returns zero when there is nothing to retry', async () => {
    const c = campaign({ status: 'COMPLETED' });
    const h = harness({ campaigns: [c], messages: [], customers: [] });
    await expect(h.svc.retryFailed(c.id)).resolves.toEqual({ ok: true, retried: 0 });
  });
});

describe('engine faults', () => {
  it('marks the campaign FAILED when the template cannot be loaded', async () => {
    const c = campaign();
    const h = harness({ campaigns: [c], messages: [message(c.id)], customers: [customer('cu1')] });
    h.templates.getById.mockRejectedValueOnce(new Error('template table unreadable'));

    await h.svc.start(c.id);
    await waitForIdle(h, c.id);

    // FAILED, not COMPLETED: the campaign never finished its work.
    expect(c.status).toBe('FAILED');
    expect(h.wa.sendText).not.toHaveBeenCalled();
  });
});
