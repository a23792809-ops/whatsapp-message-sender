import { Body, Controller, Get, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service.js';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly wa: WhatsAppService) {}

  @Get('status')
  status() {
    return this.wa.status();
  }

  @Post('test')
  async test(@Body() body: { to: string; message: string }) {
    if (!body?.to) return { ok: false, error: 'to is required' };
    return this.wa.sendText(body.to, body.message || 'Test message from WhatsApp Sender');
  }
}
