import { describe, expect, it } from 'vitest';
import { AuditService } from './audit.service.js';
import { AuditAction, AuditEntityType, AuditStatus } from './audit.types.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

function harness(rows: Row[] = []) {
  const prisma = { client: makeOrm({ AuditLog: rows }) };
  return { svc: new AuditService(prisma as any), rows };
}

describe('AuditService', () => {
  it('records an action with the supplied entity and a SYSTEM actor', async () => {
    const { svc, rows } = harness();
    await svc.record({
      action: AuditAction.CAMPAIGN_START,
      entityType: AuditEntityType.CAMPAIGN,
      entityId: 'camp-1',
      message: 'started',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'CAMPAIGN_START',
      entityType: 'campaign',
      entityId: 'camp-1',
      status: 'SUCCESS',
      actor: 'SYSTEM',
      message: 'started',
    });
  });

  it('records failures as well as successes, and never swallows the error', async () => {
    const { svc, rows } = harness();
    const boom = new Error('nope');
    await expect(
      svc.auditAction(
        { action: AuditAction.CAMPAIGN_START, entityType: AuditEntityType.CAMPAIGN, entityId: 'c1' },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'CAMPAIGN_START', status: 'FAILURE', message: 'nope' });
  });

  it('redacts credential-shaped text and bounds the summary length', async () => {
    const { svc, rows } = harness();
    await svc.record({
      action: AuditAction.WHATSAPP_TEST_SEND,
      entityType: AuditEntityType.WHATSAPP,
      message: 'token Bearer EAAGZAZAZ1234567890abcdefghij and user@example.com',
    });
    expect(rows[0].message).not.toContain('EAAGZAZAZ1234567890abcdefghij');
    expect(rows[0].message).not.toContain('user@example.com');
    expect(rows[0].message).toContain('[redacted]');

    const { svc: long, rows: longRows } = harness();
    await long.record({ action: 'X', message: 'y'.repeat(1000) });
    expect(String(longRows[0].message).length).toBeLessThanOrEqual(300);
  });

  it('filters by action, entityType, status and free-text search', async () => {
    const { svc } = harness([
      { id: 'a1', action: 'CAMPAIGN_START', entityType: 'campaign', entityId: 'c1', status: 'SUCCESS', message: 'alpha', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'a2', action: 'CAMPAIGN_STOP', entityType: 'campaign', entityId: 'c2', status: 'FAILURE', message: 'beta', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'a3', action: 'TEMPLATE_CREATE', entityType: 'template', entityId: 't1', status: 'SUCCESS', message: 'alpha template', createdAt: '2026-01-03T00:00:00Z' },
    ]);

    expect((await svc.list({ action: 'CAMPAIGN_START' })).data.map((r) => r.id)).toEqual(['a1']);
    expect((await svc.list({ entityType: 'template' })).data.map((r) => r.id)).toEqual(['a3']);
    expect((await svc.list({ status: 'FAILURE' })).data.map((r) => r.id)).toEqual(['a2']);
    expect((await svc.list({ entityId: 'c2' })).data.map((r) => r.id)).toEqual(['a2']);
    // search spans action, entityType, entityId and message
    expect((await svc.list({ search: 'alpha' })).data.map((r) => r.id)).toEqual(['a3', 'a1']);
  });

  it('paginates deterministically with createdAt DESC then id DESC', async () => {
    const { svc } = harness([
      { id: 'b', action: 'X', entityType: 'system', status: 'SUCCESS', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'a', action: 'X', entityType: 'system', status: 'SUCCESS', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'z', action: 'X', entityType: 'system', status: 'SUCCESS', createdAt: '2026-01-03T00:00:00Z' },
      { id: 'y', action: 'X', entityType: 'system', status: 'SUCCESS', createdAt: '2026-01-01T00:00:00Z' },
    ]);

    const page1 = await svc.list({ page: 1, pageSize: 2 });
    expect(page1.data.map((r) => r.id)).toEqual(['z', 'b']);
    expect(page1.meta).toEqual({ total: 4, page: 1, pageSize: 2, totalPages: 2 });

    const page2 = await svc.list({ page: 2, pageSize: 2 });
    expect(page2.data.map((r) => r.id)).toEqual(['a', 'y']);
    expect(page2.meta.page).toBe(2);
  });

  it('bounds page and pageSize', async () => {
    const { svc } = harness();
    const res = await svc.list({ page: 0, pageSize: 100000 });
    expect(res.meta.page).toBe(1);
    expect(res.meta.pageSize).toBe(200);
  });

  it('records through the campaign controller when a campaign action runs', async () => {
    // Guards the wiring: the controller, not just the service, must audit.
    const { CampaignsController } = await import('../campaigns/campaigns.controller.js');
    const auditLogs: Row[] = [];
    const auditSvc = new AuditService({ client: makeOrm({ AuditLog: auditLogs }) } as any);
    const campaigns = { create: async () => ({ id: 'c9', status: 'DRAFT' }) } as any;
    const controller = new CampaignsController(campaigns, auditSvc);

    await controller.create({ name: 'Autumn', templateId: 't1', customerIds: ['c1'] } as any);

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      action: AuditAction.CAMPAIGN_CREATE,
      entityType: AuditEntityType.CAMPAIGN,
      status: AuditStatus.SUCCESS,
    });
  });
});
