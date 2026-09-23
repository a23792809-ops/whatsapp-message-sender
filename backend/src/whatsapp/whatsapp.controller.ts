import { Body, Controller, Get, Post } from '@nestjs/common';
import { TestSendDto } from '../common/dto.js';
import { WhatsAppService } from './whatsapp.service.js';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly wa: WhatsAppService) {}

  @Get('status')
  status() {
    return this.wa.status();
  }

  @Post('test')
  async test(@Body() body: TestSendDto) {
    if (body.templateName) {
      return this.wa.sendTemplate(body.to, {
        name: body.templateName,
        language: body.language,
        parameters: body.parameters,
      });
    }
    return this.wa.sendText(body.to, body.message || 'Test message from WhatsApp Sender');
  }
}
