import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MessageQueryDto, SendMessageDto } from '../common/dto.js';
import { MessagesService } from './messages.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
  ) {}

  @Post('send')
  async send(@Body() body: SendMessageDto) {
    return this.audit.auditAction(
      {
        action: AuditAction.MESSAGE_SEND,
        entityType: AuditEntityType.MESSAGE,
        entityId: body.customerId,
        message: 'single message send',
      },
      () => this.messages.send(body.customerId, body.templateId),
    );
  }

  /**
   * Paginated history: `?page=&pageSize=&search=&status=&campaignId=&customerId=`
   * Returns `{ data, meta }`.
   */
  @Get()
  async list(@Query() query: MessageQueryDto) {
    return this.messages.list(query);
  }
}
