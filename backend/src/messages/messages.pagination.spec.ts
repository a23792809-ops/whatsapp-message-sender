import { describe, expect, it } from 'vitest';
import { MessagesService } from './messages.service.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

function harness(messages: Row[]) {
  const prisma = { client: makeOrm({ Message: messages, Customer: [] }) };
  const wa = { sendText: async () => ({ ok: true }), sendTemplate: async () => ({ ok: true }) } as any;
  const templates = { getById: async () => ({ id: 't1', body: 'hi' }) } as any;
  return { svc: new MessagesService(prisma as any, wa, templates), messages };
}

function message(id: string, over: Row = {}): Row {
  return {
    id,
    customerId: `cust-${id}`,
    campaignId: `camp-${id}`,
    mobile: `9190000${id.padStart(4, '0')}`,
    customerName: `Name ${id}`,
    content: `body ${id}`,
    status: 'PENDING',
    attemptCount: 0,
    // Ascending id order and time order, so ordering assertions are meaningful.
    createdAt: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

describe('MessagesService.list', () => {
  it('paginates database-side instead of capping the result set', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => message(String(i + 1)));
    const { svc } = harness(rows);

    const first = await svc.list({ page: 1, pageSize: 10 });
    expect(first.data).toHaveLength(10);
    expect(first.meta).toEqual({ total: 25, page: 1, pageSize: 10, totalPages: 3 });

    const last = await svc.list({ page: 3, pageSize: 10 });
    expect(last.data).toHaveLength(5);
    expect(last.meta).toEqual({ total: 25, page: 3, pageSize: 10, totalPages: 3 });

    // Every row is reachable: 25 across 3 pages, not the first 10 only.
    const seen = new Set([...first.data, ...(await svc.list({ page: 2, pageSize: 10 })).data, ...last.data].map((r) => r.id));
    expect(seen.size).toBe(25);
  });

  it('filters by status', async () => {
    const { svc } = harness([
      message('1', { status: 'SENT' }),
      message('2', { status: 'FAILED' }),
      message('3', { status: 'PENDING' }),
      message('4', { status: 'SENT' }),
    ]);
    const res = await svc.list({ status: 'sent' });
    expect(res.data.map((r) => r.id)).toEqual(['4', '1']);
    expect(res.meta.total).toBe(2);
  });

  it('filters by search across name, mobile and content', async () => {
    const { svc } = harness([
      message('1', { customerName: 'Rajesh Kumar' }),
      message('2', { customerName: 'Sunita' }),
      message('3', { content: 'special offer' }),
    ]);
    expect((await svc.list({ search: 'rajesh' })).data.map((r) => r.id)).toEqual(['1']);
    expect((await svc.list({ search: 'SUNITA' })).data.map((r) => r.id)).toEqual(['2']);
    expect((await svc.list({ search: 'offer' })).data.map((r) => r.id)).toEqual(['3']);
    expect((await svc.list({ search: 'nothing-matches' })).meta.total).toBe(0);
  });

  it('filters by campaignId and customerId', async () => {
    const { svc } = harness([
      message('1', { campaignId: 'k1', customerId: 'c1' }),
      message('2', { campaignId: 'k2', customerId: 'c1' }),
      message('3', { campaignId: 'k1', customerId: 'c2' }),
    ]);
    expect((await svc.list({ campaignId: 'k1' })).data.map((r) => r.id).sort()).toEqual(['1', '3']);
    expect((await svc.list({ customerId: 'c1' })).data.map((r) => r.id).sort()).toEqual(['1', '2']);
    expect((await svc.list({ campaignId: 'k1', customerId: 'c1' })).data.map((r) => r.id)).toEqual(['1']);
  });

  it('orders deterministically by createdAt DESC then id DESC', async () => {
    // Two rows share a createdAt, so the id tiebreaker decides between them.
    const { svc } = harness([
      message('1', { createdAt: '2026-05-05T00:00:00Z' }),
      message('2', { createdAt: '2026-06-06T00:00:00Z' }),
      message('3', { createdAt: '2026-05-05T00:00:00Z' }),
    ]);
    expect((await svc.list()).data.map((r) => r.id)).toEqual(['2', '3', '1']);

    // Paging must not reshuffle rows that straddle a page boundary.
    const page1 = await svc.list({ pageSize: 2 });
    const page2 = await svc.list({ pageSize: 2, page: 2 });
    expect(page1.data.map((r) => r.id)).toEqual(['2', '3']);
    expect(page2.data.map((r) => r.id)).toEqual(['1']);
  });

  it('combines filters with pagination', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      message(String(i + 1), { status: i % 2 === 0 ? 'SENT' : 'FAILED', campaignId: 'k1' }),
    );
    const { svc } = harness(rows);
    const res = await svc.list({ status: 'SENT', campaignId: 'k1', page: 1, pageSize: 4 });
    expect(res.meta.total).toBe(6);
    expect(res.meta.totalPages).toBe(2);
    expect(res.data).toHaveLength(4);
  });

  it('bounds page and pageSize', async () => {
    const { svc } = harness([message('1')]);
    const res = await svc.list({ page: -3, pageSize: 9999 });
    expect(res.meta.page).toBe(1);
    expect(res.meta.pageSize).toBe(200);
  });

  it('returns a well-formed envelope for an empty table', async () => {
    const { svc } = harness([]);
    expect(await svc.list()).toEqual({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } });
  });
});
