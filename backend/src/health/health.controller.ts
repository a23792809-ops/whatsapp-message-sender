import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const customers = await this.prisma.client.orm.public.Customer.all();
    const campaigns = await this.prisma.client.orm.public.Campaign.all();
    const messages = await this.prisma.client.orm.public.Message.all();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        customers: customers.length,
        campaigns: campaigns.length,
        messages: messages.length,
      },
    };
  }
}
