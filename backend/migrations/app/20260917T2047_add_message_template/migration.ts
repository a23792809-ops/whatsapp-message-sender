#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5001621235ac5a69e1a75a2a1ebdd3a47efcaa3f6bd7f5568b74a40ac8b23690/contract';
import endContract from '../../snapshots/5001621235ac5a69e1a75a2a1ebdd3a47efcaa3f6bd7f5568b74a40ac8b23690/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7ba067fd8e8632beb30d554e4ee182be2f364dc981cc7f75a18aff687fd361a/contract';
import startContract from '../../snapshots/e7ba067fd8e8632beb30d554e4ee182be2f364dc981cc7f75a18aff687fd361a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'messageTemplate',
        columns: [
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isActive', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'messageTemplate',
        constraint: 'messageTemplate_name_key',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'messageTemplate',
        index: 'messageTemplate_isActive_idx_77fe3ba1',
        columns: ['isActive'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'messageTemplate',
        index: 'messageTemplate_name_idx_ce87e6ba',
        columns: ['name'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
