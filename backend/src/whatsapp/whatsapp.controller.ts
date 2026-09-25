import { Body, Controller, Get, Post } from '@nestjs/common';
import { TestSendDto } from '../common/dto.js';
import { WhatsAppService } from './whatsapp.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Connection and readiness summary.
   *
   * `webhook` is a boolean-only view of the webhook configuration: the operator
   * needs to know whether it is set up, never what the values are. No secret
   * reaches this response.
   */
  @Get('status')
  status() {
    return { ...this.wa.status(), webhook: this.webhooks.describeConfiguration() };
  }

  @Post('test')
  async test(@Body() body: TestSendDto) {
    // Only the destination and send kind are recorded: the message body and any
    // credential stay out of the audit table.
    return this.audit.auditAction(
      {
        action: AuditAction.WHATSAPP_TEST_SEND,
        entityType: AuditEntityType.WHATSAPP,
        message: `test send to ${body.to} (${body.templateName ? 'template' : 'text'})`,
      },
      () =>
        body.templateName
          ? this.wa.sendTemplate(body.to, {
              name: body.templateName,
              language: body.language,
              parameters: body.parameters,
            })
          : this.wa.sendText(body.to, body.message || 'Test message from WhatsApp Sender'),
    );
  }
}
