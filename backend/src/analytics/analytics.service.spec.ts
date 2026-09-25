import { describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

function harness(customers: Row[], campaigns: Row[], messages: Row[]) {
  const prisma = { client: makeOrm({ Customer: customers, Campaign: campaigns, Message: messages }) };
  return new AnalyticsService(prisma as any);
}

function customer(id: string, status: string): Row {
  return { id, mobile: `9${id}`, name: `C${id}`, status, createdAt: '2026-01-01T00:00:00Z' };
}
function campaign(id: string, status: string, over: Row = {}): Row {
  return { id, name: `Camp ${id}`, status, total: 0, sent: 0, failed: 0, pending: 0, createdAt: '2026-01-01T00:00:00Z', ...over };
}
function message(id: string, status: string): Row {
  return { id, status, customerId: 'c1', campaignId: 'k1', mobile: '999', customerName: 'X', content: 'hi', createdAt: '2026-01-01T00:00:00Z' };
}

describe('AnalyticsService', () => {
  it('aggregates customers, campaigns and messages from the database', async () => {
    const svc = harness(
      [customer('1', 'SENT'), customer('2', 'COMPLETED'), customer('3', 'PENDING'), customer('4', 'FAILED'), customer('5', 'PENDING')],
      [campaign('k1', 'COMPLETED'), campaign('k2', 'RUNNING'), campaign('k3', 'PAUSED'), campaign('k4', 'COMPLETED')],
      [message('m1', 'SENT'), message('m2', 'SENT'), message('m3', 'SENT'), message('m4', 'FAILED')],
    );

    const stats = await svc.dashboard();

    expect(stats.customers).toEqual({ total: 5, pending: 2, sent: 2, failed: 1 });
    expect(stats.campaigns).toEqual({ total: 4, running: 2, completed: 2 });
    expect(stats.messages).toEqual({ total: 4, sent: 3, failed: 1, pending: 0 });
    // 3 sent of 4 processed -> 75%
    expect(stats.successRate).toBe(75);
  });

  it('reports a success rate of 0, not 100, when nothing has been processed', async () => {
    const svc = harness([customer('1', 'PENDING')], [campaign('k1', 'DRAFT')], [message('m1', 'PENDING')]);
    const stats = await svc.dashboard();
    expect(stats.messages).toEqual({ total: 1, sent: 0, failed: 0, pending: 1 });
    expect(stats.successRate).toBe(0);
  });

  it('reports a success rate of 0 for a completely empty database', async () => {
    const stats = await harness([], [], []).dashboard();
    expect(stats).toMatchObject({
      customers: { total: 0, pending: 0, sent: 0, failed: 0 },
      campaigns: { total: 0, running: 0, completed: 0 },
      messages: { total: 0, sent: 0, failed: 0, pending: 0 },
      successRate: 0,
    });
    expect(stats.recentCampaigns).toEqual([]);
  });

  it('counts only messages with an outcome toward the success rate', async () => {
    // 1 sent, 1 failed, 8 still pending -> 50%, not 11%.
    const svc = harness(
      [],
      [],
      [message('m1', 'SENT'), message('m2', 'FAILED'), ...Array.from({ length: 8 }, (_, i) => message(`p${i}`, 'PENDING'))],
    );
    const stats = await svc.dashboard();
    expect(stats.messages.total).toBe(10);
    expect(stats.successRate).toBe(50);
  });

  it('returns the most recent campaigns first, bounded to five', async () => {
    const campaigns = Array.from({ length: 7 }, (_, i) =>
      campaign(`k${i}`, 'COMPLETED', { createdAt: `2026-01-0${i + 1}T00:00:00Z`, sent: i, total: i }),
    );
    const stats = await harness([], campaigns, []).dashboard();
    expect(stats.recentCampaigns).toHaveLength(5);
    expect(stats.recentCampaigns[0].id).toBe('k6');
    expect(stats.recentCampaigns[4].id).toBe('k2');
  });

  it('exposes campaign counters alongside the summary', async () => {
    const svc = harness([], [campaign('k1', 'COMPLETED', { total: 10, sent: 8, failed: 1, pending: 1 })], []);
    const stats = await svc.dashboard();
    expect(stats.recentCampaigns[0]).toMatchObject({ id: 'k1', total: 10, sent: 8, failed: 1, pending: 1 });
  });
});
