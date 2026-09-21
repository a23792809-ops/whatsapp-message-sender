import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    CustomersModule,
    TemplatesModule,
    WhatsAppModule,
    MessagesModule,
    CampaignsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
