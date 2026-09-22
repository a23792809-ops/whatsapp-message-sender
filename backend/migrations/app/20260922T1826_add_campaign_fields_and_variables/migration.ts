#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/29fba39f18e7d72602e5f5f6c06b5f986d8611882e96d32ab4bacece2729e5f7/contract';
import endContract from '../../snapshots/29fba39f18e7d72602e5f5f6c06b5f986d8611882e96d32ab4bacece2729e5f7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5001621235ac5a69e1a75a2a1ebdd3a47efcaa3f6bd7f5568b74a40ac8b23690/contract';
import startContract from '../../snapshots/5001621235ac5a69e1a75a2a1ebdd3a47efcaa3f6bd7f5568b74a40ac8b23690/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'campaign',
        column: col('templateId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'campaign',
        column: col('throttleMs', 'int4', {
          notNull: true,
          default: lit(19000),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'customer',
        column: col('variables', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('attemptCount', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
