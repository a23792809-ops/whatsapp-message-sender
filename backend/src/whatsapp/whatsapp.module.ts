import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  // One-directional: the WhatsApp page needs to report webhook readiness, and
  // the webhook module has no reason to know about the sender.
  imports: [WebhooksModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
