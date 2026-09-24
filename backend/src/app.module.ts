import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { CustomersModule } from './customers/customers.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { AiModule } from './ai/ai.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    CustomersModule,
    TemplatesModule,
    WhatsAppModule,
    MessagesModule,
    CampaignsModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
