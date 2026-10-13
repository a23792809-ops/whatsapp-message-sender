import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/auth.guard.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    // Row counts are computed INSIDE the database with a single aggregate per
    // table. Materialising `Customer.all()` / `Message.all()` to count them
    // would pull every row into memory on every health probe — and probes run
    // far more often than the app does real work.
    const count = async (kind: 'Customer' | 'Campaign' | 'Message'): Promise<number> => {
      const api = (this.prisma.client as any).orm?.public?.[kind];
      const res = await api.aggregate((a: any) => ({ n: a.count() }));
      return typeof res?.n === 'number' ? Number(res.n) : 0;
    };

    const [customers, campaigns, messages] = await Promise.all([
      count('Customer'),
      count('Campaign'),
      count('Message'),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        customers,
        campaigns,
        messages,
      },
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    // Lightweight readiness check; confirms app is initialized.
    return { status: 'ok', ready: true, timestamp: new Date().toISOString() };
  }
  }
}