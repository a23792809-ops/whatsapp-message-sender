import { Injectable, Logger } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditActor, AuditQuery, AuditRecordInput, AuditStatus } from './audit.types.js';
import { clampPage, clampPageSize } from '../common/pagination.js';

/** Longest summary we ever persist. Keeps audit rows small and bounded. */
const MESSAGE_MAX = 300;

/**
 * Defence in depth against a secret reaching the audit table. Callers are not
 * expected to pass credentials, but this scrubs the few shapes that would be
 * most damaging if one slipped through.
 */
function redact(input: string | undefined): string | undefined {
  if (input === undefined || input === null) return undefined;
  let text = String(input)
    .replace(/\b(bearer)\s+[A-Za-z0-9._-]+/gi, '$1 [redacted]')
    .replace(/\b(eyJ[A-Za-z0-9._-]{10,})\b/g, '[redacted]')
    .replace(/\b(EA[A-Za-z0-9]{20,})\b/g, '[redacted]')
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[redacted-email]')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (text.length > MESSAGE_MAX) text = `${text.slice(0, MESSAGE_MAX - 1)}…`;
  return text.length ? text : undefined;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get api(): any {
    return (this.prisma.client as any).orm?.public?.AuditLog;
  }

  /**
   * Records one business action.
   *
   * Auditing must never be able to fail the operation it describes, so every
   * error is swallowed after being logged. Callers may await this safely.
   */
  async record(input: AuditRecordInput): Promise<void> {
    const api = this.api;
    if (!api?.createAll) {
      this.logger.warn('AuditLog model unavailable; skipping audit entry');
      return;
    }
    const values = {
      action: String(input.action).slice(0, 100),
      entityType: String(input.entityType ?? 'system').slice(0, 60),
      entityId: input.entityId === undefined || input.entityId === null ? null : String(input.entityId).slice(0, 100),
      status: String(input.status ?? 'SUCCESS').slice(0, 40),
      actor: String(input.actor ?? AuditActor.SYSTEM).slice(0, 60),
      message: redact(input.message ?? undefined) ?? null,
    };
    try {
      const res = await api.createAll([values]);
      const rows = Array.isArray(res) ? res : await res;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('createAll returned empty');
    } catch (e) {
      this.logger.warn(`Failed to record audit ${values.action}: ${(e as Error).message}`);
    }
  }

  /**
   * Runs a business action and records the outcome either way.
   *
   * Centralising this keeps every call site to one line and guarantees a failed
   * action is still recorded. The original error is always rethrown: auditing
   * observes the action, it never changes its result.
   */
  async auditAction<T>(input: AuditRecordInput, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      await this.record({ ...input, status: AuditStatus.SUCCESS });
      return result;
    } catch (e) {
      await this.record({
        ...input,
        status: AuditStatus.FAILURE,
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /** Read-only, database-filtered, database-paginated audit history. */
  async list(query: AuditQuery = {}) {
    const api = this.api;
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    if (!api) return { data: [], meta: { total: 0, page, pageSize, totalPages: 1 } };

    const search = (query.search ?? '').trim();
    const action = (query.action ?? '').trim();
    const entityType = (query.entityType ?? '').trim();
    const entityId = (query.entityId ?? '').trim();
    const status = (query.status ?? '').trim().toUpperCase();

    let collection: any = api;
    if (action) collection = collection.where((a: any) => a.action.eq(action));
    if (entityType) collection = collection.where((a: any) => a.entityType.eq(entityType));
    if (entityId) collection = collection.where((a: any) => a.entityId.eq(entityId));
    if (status && status !== 'ALL') collection = collection.where((a: any) => a.status.eq(status));
    if (search) {
      const like = `%${search}%`;
      collection = collection.where((a: any) =>
        or(a.action.ilike(like), a.entityType.ilike(like), a.entityId.ilike(like), a.message.ilike(like)),
      );
    }

    // Counting and paging both happen in the database; the table is never
    // materialised in the application process.
    const counted = await collection.aggregate((a: any) => ({ n: a.count() }));
    const total = Number(counted?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const data = await collection
      .orderBy([(a: any) => a.createdAt.desc(), (a: any) => a.id.desc()])
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    return { data, meta: { total, page, pageSize, totalPages } };
  }
}
