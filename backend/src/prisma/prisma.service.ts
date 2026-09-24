import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { db } from './db.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client = db;

  async onModuleInit() {
    await db.connect();
    await (db.orm as any).public.Customer.aggregate((a: any) => ({ n: a.count() }));
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await db.close();
    this.logger.log('Prisma disconnected from PostgreSQL');
  }
}
