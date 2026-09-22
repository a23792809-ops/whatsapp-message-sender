import { Body, Controller, Get, Post } from '@nestjs/common';
import { SendMessageDto } from '../common/dto.js';
import { MessagesService } from './messages.service.js';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('send')
  async send(@Body() body: SendMessageDto) {
    return this.messages.send(body.customerId, body.templateId);
  }

  @Get()
  async list() {
    return this.messages.list(100);
  }
}
