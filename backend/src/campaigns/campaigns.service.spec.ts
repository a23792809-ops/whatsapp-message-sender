import { describe, expect, it, vi } from 'vitest';
import { CampaignsService } from './campaigns.service.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

type Seed = {
  campaigns?: Row[];
  messages?: Row[];
  customers?: Row[];
  send?: (mobile: string, content: string) => Promise<any>;
};

function buildService(opts: Seed) {
  const campaigns = opts.campaigns ?? [];
  const messages = opts.messages ?? [];
  const customers = opts.customers ?? [];
  const template = { id: 't1', body: 'Hello {{customer_name}}', metaName: null, metaLanguage: 'en' };

  const wa = {
    sendText: vi.fn(opts.send ?? (async () => ({ ok: true, mode: 'dry', whatsappId: 'dry-id' }))),
    sendTemplate: vi.fn(async () => ({ ok: true, mode: 'dry', whatsappId: 'dry-id' })),
  };
  const templates = { getById: vi.fn(async () => template) };
  const prisma = { client: makeOrm({ Campaign: campaigns, Message: messages, Customer: customers }) };
  const svc = new CampaignsService(prisma as any, wa as any, templates as any);

  return { svc, wa, templates, template, campaigns, messages, customers };
}

async function until(fn: () => boolean, timeout = 4000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeout) throw new Error('condition was not reached in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function runningCampaign(overrides: Row = {}): Row {
  return {
    id: 'c1',
    name: 'Campaign 1',
    status: 'RUNNING',
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

function message(overrides: Row = {}): Row {
  return {
    id: 'm1',
    campaignId: 'c1',
    customerId: 'cu1',
    mobile: '919876543210',
    customerName: 'Ram',
    content: '',
    status: 'PENDING',
    attemptCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function customers(): Row[] {
  return [{ id: 'cu1', mobile: '919876543210', name: 'Ram', variables: null }];
}

async function waitForRunnerToFinish(svc: CampaignsService, id = 'c1') {
  await until(() => (svc as any).engines.get(id)?.running === false);
}

describe('CampaignsService restart recovery', () => {
  it('recovers a RUNNING campaign after service bootstrap', async () => {
    const campaigns = [runningCampaign()];
    const messages = [message()];
    const { svc, wa } = buildService({ campaigns, messages, customers: customers() });

    await (svc as any).onApplicationBootstrap();

    await until(() => (svc as any).engines.get('c1')?.running === true);
    await waitForRunnerToFinish(svc);

    expect(campaigns[0].status).toBe('COMPLETED');
    expect(campaigns[0].sent).toBe(1);
    expect(campaigns[0].pending).toBe(0);
    expect(messages[0].status).toBe('SENT');
    expect(messages[0].attemptCount).toBe(1);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
    expect(wa.sendText).toHaveBeenCalledWith('919876543210', 'Hello Ram');
  });

  it('does not automatically resume a PAUSED campaign', async () => {
    const campaigns = [runningCampaign({ status: 'PAUSED' })];
    const messages = [message()];
    const { svc, wa } = buildService({ campaigns, messages, customers: customers() });

    const result = await (svc as any).recoverRunning();

    expect(result.recovered).toEqual([]);
    expect((svc as any).engines.has('c1')).toBe(false);
    expect(campaigns[0].status).toBe('PAUSED');
    expect(messages[0].status).toBe('PENDING');
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it('does not automatically resume a STOPPED campaign', async () => {
    const campaigns = [runningCampaign({ status: 'STOPPED' })];
    const messages = [message()];
    const { svc, wa } = buildService({ campaigns, messages, customers: customers() });

    const result = await (svc as any).recoverRunning();

    expect(result.recovered).toEqual([]);
    expect((svc as any).engines.has('c1')).toBe(false);
    expect(campaigns[0].status).toBe('STOPPED');
    expect(messages[0].status).toBe('PENDING');
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it('does not resend SENT messages and continues PENDING messages after recovery', async () => {
    const campaigns = [runningCampaign({ total: 2, pending: 1 })];
    const messages = [
      message({ id: 'm1', status: 'SENT', attemptCount: 1, whatsappId: 'wam-existing', content: 'Hello Ram' }),
      message({
        id: 'm2',
        customerId: 'cu2',
        mobile: '919876543211',
        customerName: 'Shyam',
        status: 'PENDING',
        attemptCount: 2,
        createdAt: '2026-01-02T00:00:00Z',
      }),
    ];
    const customersRows = [
      { id: 'cu1', mobile: '919876543210', name: 'Ram', variables: null },
      { id: 'cu2', mobile: '919876543211', name: 'Shyam', variables: null },
    ];
    const { svc, wa } = buildService({ campaigns, messages, customers: customersRows });

    const result = await (svc as any).recoverRunning();

    expect(result.recovered).toEqual(['c1']);
    await waitForRunnerToFinish(svc);

    // m1 was already SENT before the restart: untouched, not re-sent.
    expect(messages[0].status).toBe('SENT');
    expect(messages[0].whatsappId).toBe('wam-existing');
    expect(messages[0].attemptCount).toBe(1);
    // m2 was PENDING before the restart: delivered exactly once.
    expect(messages[1].status).toBe('SENT');
    expect(messages[1].attemptCount).toBe(3);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
    expect(wa.sendText).toHaveBeenCalledWith('919876543211', 'Hello Shyam');

    expect(campaigns[0].status).toBe('COMPLETED');
    expect(campaigns[0].sent).toBe(2);
    expect(campaigns[0].pending).toBe(0);
  });

  it('never spawns a second runner on repeated recovery attempts', async () => {
    const campaigns = [runningCampaign({ throttleMs: 100 })];
    const messages = [message()];
    const { svc, wa } = buildService({ campaigns, messages, customers: customers() });

    const first = await (svc as any).recoverRunning();
    const second = await (svc as any).recoverRunning();

    expect(first.recovered).toEqual(['c1']);
    expect(second.recovered).toEqual([]);
    expect(second.skipped).toEqual(['c1']);

    await waitForRunnerToFinish(svc);

    expect(messages[0].status).toBe('SENT');
    expect(messages[0].attemptCount).toBe(1);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it('preserves the retry budget across recovery and gives up after MAX_ATTEMPTS', async () => {
    // attemptCount starts at 2 (one prior failed send before the restart),
    // so the last recovery attempt already hits the permanent-failure limit.
    const campaigns = [runningCampaign()];
    const messages = [message({ attemptCount: 2 })];
    const send = async () => ({ ok: false, error: 'boom' });
    const { svc, wa } = buildService({ campaigns, messages, customers: customers(), send });

    const result = await (svc as any).recoverRunning();
    expect(result.recovered).toEqual(['c1']);

    await waitForRunnerToFinish(svc);

    expect(messages[0].status).toBe('FAILED');
    expect(messages[0].attemptCount).toBe(3);
    expect(messages[0].error).toBe('boom');
    expect(wa.sendText).toHaveBeenCalledTimes(1);
    expect(campaigns[0].failed).toBe(1);
    expect(campaigns[0].pending).toBe(0);
    expect(campaigns[0].status).toBe('COMPLETED');
  });

  it('retries transient failures up to MAX_ATTEMPTS before failing permanently', async () => {
    const campaigns = [runningCampaign()];
    const messages = [message({ attemptCount: 1 })];
    const send = async () => ({ ok: false, error: 'transient' });
    const { svc, wa } = buildService({ campaigns, messages, customers: customers(), send });

    await (svc as any).onApplicationBootstrap();
    await waitForRunnerToFinish(svc);

    expect(wa.sendText).toHaveBeenCalledTimes(2);
    expect(messages[0].status).toBe('FAILED');
    expect(messages[0].attemptCount).toBe(3);
    expect(messages[0].error).toBe('transient');
    expect(campaigns[0].failed).toBe(1);
    expect(campaigns[0].status).toBe('COMPLETED');
  });
});
