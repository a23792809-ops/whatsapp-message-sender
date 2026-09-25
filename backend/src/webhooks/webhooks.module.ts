import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * The webhook module owns no providers beyond the service and controller: the
 * audit trail comes from the global AuditModule, and database access from the
 * global PrismaModule. Keeping the surface small makes the security-relevant
 * code easy to review in isolation.
 */
@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
