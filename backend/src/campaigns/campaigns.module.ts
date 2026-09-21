import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { TemplatesModule } from '../templates/templates.module.js';

@Module({
  imports: [WhatsAppModule, TemplatesModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
