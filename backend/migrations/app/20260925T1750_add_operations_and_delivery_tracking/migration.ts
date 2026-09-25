#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b84d0fa1cc8c20a547de64a5b9c5a255f469f8de3da25a6279cb5f07bd8caad3/contract';
import startContract from '../../snapshots/b84d0fa1cc8c20a547de64a5b9c5a255f469f8de3da25a6279cb5f07bd8caad3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/cac7204061a2a2527c433770e0cb98430fccfa10b1dd5dc86f294948fc89a082/contract';
import endContract from '../../snapshots/cac7204061a2a2527c433770e0cb98430fccfa10b1dd5dc86f294948fc89a082/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'appSetting',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['key'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'auditLog',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('actor', 'text', {
            notNull: true,
            default: lit('SYSTEM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('entityId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('entityType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('message', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('SUCCESS'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('deliveredAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('errorCode', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('failedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('readAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'auditLog',
        index: 'auditLog_action_idx_cd0d2116',
        columns: ['action'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'auditLog',
        index: 'auditLog_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'auditLog',
        index: 'auditLog_entityId_idx_18814ca5',
        columns: ['entityId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'auditLog',
        index: 'auditLog_entityType_idx_9cffc2ff',
        columns: ['entityType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'auditLog',
        index: 'auditLog_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_whatsappId_idx_028afc20',
        columns: ['whatsappId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
