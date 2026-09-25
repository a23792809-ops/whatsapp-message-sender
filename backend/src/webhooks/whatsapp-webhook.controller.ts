import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  type Request,
} from '@nestjs/common';
import { Public } from '../auth/auth.guard.js';
import { WebhooksService } from './webhooks.service.js';
import { WhatsAppWebhookDto } from './dto/whatsapp-webhook.dto.js';

/**
 * Meta WhatsApp Cloud API webhook endpoint.
 *
 * Both routes are `@Public()`: Meta authenticates with a verify token (GET) and
 * an HMAC signature (POST), never with a session. The global auth guard stays
 * enabled everywhere else — only these two routes opt out, and only after their
 * own verification succeeds.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * Subscription verification handshake.
   *
   * Meta calls this once when the callback URL is registered. On success we echo
   * the challenge as plain text; on failure we return 403 and never reveal
   * whether a token was configured or merely wrong.
   */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    return this.webhooks.verifySubscription({ mode, verifyToken, challenge });
  }

  /**
   * Delivery-status events.
   *
   * Always answers 200 once the request is authentic, including for events we
   * cannot use. Meta retries any non-2xx aggressively, so failing a harmless
   * payload would create a retry storm and, worse, hide real failures in noise.
   */
  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Body() payload: WhatsAppWebhookDto,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ ok: true; received: number; applied: number; ignored: number }> {
    // Signature is checked against the *raw* bytes, before any parsing could
    // have altered them. This throws 401/403 on a bad or missing signature.
    this.webhooks.assertValidSignature(request?.rawBody, signature);

    const result = await this.webhooks.process(payload);
    return {
      ok: true,
      received: result.received,
      applied: result.applied,
      ignored: result.ignored + result.unsupported + result.unknownMessage + result.malformed,
    };
  }
}
