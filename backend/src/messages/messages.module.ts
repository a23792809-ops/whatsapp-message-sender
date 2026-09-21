import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { TemplatesModule } from '../templates/templates.module.js';

@Module({
  imports: [WhatsAppModule, TemplatesModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
