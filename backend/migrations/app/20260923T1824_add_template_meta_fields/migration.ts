#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/29fba39f18e7d72602e5f5f6c06b5f986d8611882e96d32ab4bacece2729e5f7/contract';
import startContract from '../../snapshots/29fba39f18e7d72602e5f5f6c06b5f986d8611882e96d32ab4bacece2729e5f7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b84d0fa1cc8c20a547de64a5b9c5a255f469f8de3da25a6279cb5f07bd8caad3/contract';
import endContract from '../../snapshots/b84d0fa1cc8c20a547de64a5b9c5a255f469f8de3da25a6279cb5f07bd8caad3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'messageTemplate',
        column: col('metaLanguage', 'text', {
          default: lit('en'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'messageTemplate',
        column: col('metaName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
