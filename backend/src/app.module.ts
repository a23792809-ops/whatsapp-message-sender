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
import { AuditModule } from './audit/audit.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

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
    // AuditModule is @Global: every module can record actions without importing it.
    AuditModule,
    SettingsModule,
    AnalyticsModule,
    // Meta's delivery callbacks. Its two routes are @Public and authenticate
    // themselves via verify token / HMAC signature instead of a session.
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
