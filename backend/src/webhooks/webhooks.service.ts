import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType, AuditStatus } from '../audit/audit.types.js';
import type {
  WhatsAppWebhookDto,
  WhatsAppWebhookStatusDto,
} from './dto/whatsapp-webhook.dto.js';
import {
  DeliveryStatus,
  MAX_ERROR_LENGTH,
  WEBHOOK_STATUS_MAP,
  describeFailure,
  resolveEventTimestamp,
  resolveTransition,
  type DeliveryStatusValue,
} from './webhooks.types.js';

/** Outcome of processing one webhook POST, for the HTTP response and logs. */
export type WebhookProcessResult = {
  received: number;
  applied: number;
  ignored: number;
  unsupported: number;
  unknownMessage: number;
  malformed: number;
};

export const EMPTY_RESULT: WebhookProcessResult = {
  received: 0,
  applied: 0,
  ignored: 0,
  unsupported: 0,
  unknownMessage: 0,
  malformed: 0,
};

/**
 * Defensive ceiling on how many delivery events one request may drive into the
 * database. The DTO already bounds each array; this is a second line of defence
 * so a malformed or hostile payload can never turn into an unbounded write
 * burst. Anything beyond it is counted and dropped.
 */
const MAX_EVENTS_PER_REQUEST = 200;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  /** Emitted once per process so a missing App Secret cannot flood the log. */
  private warnedAboutMissingAppSecret = false;
  /** Set once Meta completes a successful GET verification against us. */
  private metaVerified = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get messageApi(): any {
    return (this.prisma.client as any).orm?.public?.Message;
  }

  private get verifyToken(): string {
    return this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN') || '';
  }

  private get appSecret(): string {
    return this.config.get<string>('WHATSAPP_APP_SECRET') || '';
  }

  /**
   * True when a signature must be present and valid.
   *
   * Fails closed in production and in live mode: without an App Secret a
   * signature cannot be checked, and an unverified webhook endpoint is a
   * forgery oracle. In development/dry-run it is permissive so the feature can
   * be exercised locally without provisioning an app secret — a documented
   * test-mode affordance, never a production one.
   */
  get signatureRequired(): boolean {
    if (this.appSecret) return true;
    const env = (this.config.get<string>('NODE_ENV') || '').toLowerCase();
    const mode = (this.config.get<string>('WHATSAPP_MODE') || 'dry').toLowerCase();
    return env === 'production' || mode === 'live';
  }

  get verificationConfigured(): boolean {
    return this.verifyToken.length > 0;
  }

  get signatureConfigured(): boolean {
    return this.appSecret.length > 0;
  }

  /** Non-secret configuration summary for the /whatsapp status page. */
  describeConfiguration(): {
    endpoint: string;
    verificationConfigured: boolean;
    signatureConfigured: boolean;
    signatureRequired: boolean;
    /** False until Meta has actually called our GET verification successfully. */
    verifiedByMeta: boolean;
  } {
    return {
      endpoint: '/webhooks/whatsapp',
      verificationConfigured: this.verificationConfigured,
      signatureConfigured: this.signatureConfigured,
      signatureRequired: this.signatureRequired,
      verifiedByMeta: this.metaVerified,
    };
  }

  /* ---------------------------------------------------------------- */
  /* GET verification                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Meta's subscription handshake.
   *
   * Compares the presented token against the server-side value with a
   * constant-time comparison. Neither the presented token nor the configured
   * one is ever logged or echoed back — only the challenge is returned.
   */
  verifySubscription(params: {
    mode?: string;
    verifyToken?: string;
    challenge?: string;
  }): string {
    const mode = (params.mode ?? '').trim();
    const presented = params.verifyToken ?? '';
    const challenge = params.challenge ?? '';
    const expected = this.verifyToken;

    if (mode !== 'subscribe') {
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: `verification rejected: unexpected mode "${mode.slice(0, 32)}"`,
      });
      throw new ForbiddenException('Webhook verification failed.');
    }

    // An unconfigured server can never verify anything. Saying so plainly is
    // more useful to an operator than a generic 403.
    if (!expected) {
      this.logger.error('Webhook verification attempted but WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured');
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'verification rejected: server verify token not configured',
      });
      throw new ServiceUnavailableException('Webhook verification is not configured on this server.');
    }

    if (!this.constantTimeEquals(presented, expected)) {
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'verification rejected: token mismatch',
      });
      throw new ForbiddenException('Webhook verification failed.');
    }

    this.metaVerified = true;
    this.logger.log('WhatsApp webhook subscription verified by Meta');
    void this.audit.record({
      action: AuditAction.WHATSAPP_WEBHOOK_RECEIVED,
      entityType: AuditEntityType.WHATSAPP,
      message: 'subscription verification accepted',
    });

    // Meta sends a short numeric challenge. We echo it verbatim (it must match
    // exactly) but refuse anything long or non-numeric so the endpoint cannot
    // be used as a generic text reflector.
    if (!/^\d{1,255}$/.test(challenge)) {
      this.logger.error('Verification token matched but challenge was not numeric; refusing to echo');
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'verification rejected: malformed challenge',
      });
      throw new ForbiddenException('Webhook verification failed.');
    }

    return challenge;
  }

  /**
   * Constant-time token comparison.
   *
   * Both sides are hashed to a fixed 32 bytes first, so `timingSafeEqual`
   * cannot throw on a length mismatch and the comparison does not leak the
   * secret's length through an early return.
   */
  private constantTimeEquals(a: string, b: string): boolean {
    const hashA = createHash('sha256').update(a, 'utf8').digest();
    const hashB = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(hashA, hashB);
  }

  /* ---------------------------------------------------------------- */
  /* POST signature verification                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies Meta's `X-Hub-Signature-256` over the **raw** request body.
   *
   * The signature covers the exact bytes Meta sent, so this must run against a
   * raw buffer captured before JSON parsing — never against a re-serialised
   * object, which would change key order and whitespace.
   *
   * Returns true when the request may proceed. Throws 401 otherwise.
   */
  assertValidSignature(rawBody: Buffer | undefined, header: string | undefined): void {
    if (!this.signatureRequired) {
      if (!this.warnedAboutMissingAppSecret) {
        this.warnedAboutMissingAppSecret = true;
        this.logger.warn(
          'WHATSAPP_APP_SECRET is not set; webhook signatures are NOT verified (development/dry-run only). ' +
            'Set it before running in production or live mode.',
        );
      }
      return;
    }

    const presented = (header ?? '').trim();
    if (!presented) {
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'POST rejected: missing signature header',
      });
      throw new ForbiddenException('Missing webhook signature.');
    }

    // Without a raw body we cannot reproduce Meta's bytes, so we must fail.
    if (!rawBody || rawBody.length === 0) {
      this.logger.error('Webhook signature could not be verified: raw request body unavailable');
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'POST rejected: raw body unavailable for signature check',
      });
      throw new ForbiddenException('Webhook signature could not be verified.');
    }

    const match = /^sha256=([a-f0-9]{64})$/i.exec(presented);
    if (!match) {
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'POST rejected: malformed signature header',
      });
      throw new ForbiddenException('Invalid webhook signature.');
    }

    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(match[1].toLowerCase(), 'hex');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      // The signature itself is never logged.
      void this.audit.record({
        action: AuditAction.WHATSAPP_WEBHOOK_REJECTED,
        entityType: AuditEntityType.WHATSAPP,
        status: AuditStatus.FAILURE,
        message: 'POST rejected: signature mismatch',
      });
      throw new ForbiddenException('Invalid webhook signature.');
    }
  }

  /* ---------------------------------------------------------------- */
  /* POST event processing                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Applies one webhook payload.
   *
   * Never throws for a payload we merely do not understand: unknown ids,
   * unknown statuses and replays are counted and answered with 200 so Meta
   * stops retrying a harmless event. Only transport-level problems (bad
   * signature, unparseable body) produce a 4xx.
   */
  async process(payload: WhatsAppWebhookDto): Promise<WebhookProcessResult> {
    const result: WebhookProcessResult = { ...EMPTY_RESULT };

    const statuses: WhatsAppWebhookStatusDto[] = [];
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const status of change?.value?.statuses ?? []) statuses.push(status);
      }
    }
    result.received = statuses.length;

    void this.audit.record({
      action: AuditAction.WHATSAPP_WEBHOOK_RECEIVED,
      entityType: AuditEntityType.WHATSAPP,
      message: `webhook accepted: ${statuses.length} delivery event(s)`,
    });

    if (statuses.length === 0) {
      // Inbound messages, account updates, echoes: valid, uninteresting.
      return result;
    }

    const receivedAt = new Date();
    let budget = MAX_EVENTS_PER_REQUEST;
    /** Unknown ids already audited in this request, to avoid duplicate rows. */
    const seenUnknown = new Set<string>();

    for (const status of statuses) {
      if (budget-- <= 0) {
        this.logger.warn(`Webhook payload exceeded ${MAX_EVENTS_PER_REQUEST} events; remainder ignored`);
        break;
      }
      await this.applyStatusEvent(status, receivedAt, result, seenUnknown);
    }

    this.logger.log(
      `Webhook processed: received=${result.received} applied=${result.applied} ignored=${result.ignored} ` +
        `unsupported=${result.unsupported} unknown=${result.unknownMessage} malformed=${result.malformed}`,
    );
    return result;
  }

  /** One delivery event. Never throws. */
  private async applyStatusEvent(
    status: WhatsAppWebhookStatusDto,
    receivedAt: Date,
    result: WebhookProcessResult,
    seenUnknown: Set<string>,
  ): Promise<void> {
    const rawStatus = (status?.status ?? '').trim().toLowerCase();
    const incoming = WEBHOOK_STATUS_MAP[rawStatus];

    if (!incoming) {
      result.unsupported += 1;
      this.logger.debug(`Ignoring unmodelled webhook status "${rawStatus.slice(0, 32)}"`);
      return;
    }

    const whatsappId = (status?.id ?? '').trim();
    if (!whatsappId) {
      result.malformed += 1;
      return;
    }

    const message = await this.findByWhatsappId(whatsappId);
    if (!message) {
      // Never fabricate a message and never 500: an id we do not know is
      // normal (a send from another tool, or a record we have already pruned).
      result.unknownMessage += 1;
      if (!seenUnknown.has(whatsappId)) {
        seenUnknown.add(whatsappId);
        void this.audit.record({
          action: AuditAction.WHATSAPP_STATUS_UNKNOWN_MESSAGE,
          entityType: AuditEntityType.MESSAGE,
          status: AuditStatus.FAILURE,
          message: `no message for whatsappId ${whatsappId.slice(0, 64)} (status ${rawStatus})`,
        });
      }
      return;
    }

    const decision = resolveTransition(message.status, incoming);
    if (decision.action === 'unsupported') {
      result.unsupported += 1;
      return;
    }
    if (decision.action === 'skip') {
      // Replays and out-of-order events land here. No write, and no audit row:
      // Meta redelivers freely and we must not spam the trail.
      result.ignored += 1;
      this.logger.debug(`Webhook status ignored for message ${message.id}: ${decision.reason}`);
      return;
    }

    const patch = this.buildPatch(message, decision.next, status, receivedAt);
    if (Object.keys(patch).length === 0) {
      result.ignored += 1;
      return;
    }

    try {
      await this.messageApi.where({ id: message.id }).update(patch);
      result.applied += 1;
      void this.audit.record({
        action: AuditAction.WHATSAPP_STATUS_UPDATED,
        entityType: AuditEntityType.MESSAGE,
        entityId: String(message.id),
        message: `${message.status} -> ${decision.next} (${decision.reason})`,
      });
      this.logger.log(`Message ${message.id} delivery ${message.status} -> ${decision.next}`);
    } catch (e) {
      // A per-message write failure must not fail the whole batch: Meta would
      // retry the entire payload and we would loop on the same bad row.
      result.ignored += 1;
      this.logger.error(`Failed to apply delivery status to message ${message.id}: ${(e as Error).message}`);
    }
  }

  /**
   * Builds the minimal update for an accepted transition.
   *
   * Timestamp semantics: each lifecycle column is written at most once, and
   * only when currently null. The first observation of a state is the one we
   * keep, so a redelivered or late event can never rewrite history or null out
   * a value we already hold. Meta's own event time is preferred; local receipt
   * time is the fallback (see `resolveEventTimestamp`).
   */
  private buildPatch(
    message: any,
    next: DeliveryStatusValue,
    status: WhatsAppWebhookStatusDto,
    receivedAt: Date,
  ): Record<string, any> {
    const at = this.toInstant(resolveEventTimestamp(status?.timestamp, receivedAt));
    const patch: Record<string, any> = { status: next };

    if (next === DeliveryStatus.SENT && !message.sentAt) patch.sentAt = at;
    if (next === DeliveryStatus.DELIVERED && !message.deliveredAt) patch.deliveredAt = at;
    if (next === DeliveryStatus.READ && !message.readAt) patch.readAt = at;

    if (next === DeliveryStatus.FAILED) {
      if (!message.failedAt) patch.failedAt = at;
      const failure = describeFailure(status?.errors);
      if (failure) {
        patch.error = failure.text.slice(0, MAX_ERROR_LENGTH);
        if (failure.code !== null) patch.errorCode = failure.code;
      }
      // No description and nothing to add: keep whatever error the send path
      // already recorded rather than overwriting it with null.
    }

    return patch;
  }

  /** Single indexed lookup by the Meta message id. Never loads a table. */
  private async findByWhatsappId(whatsappId: string): Promise<any> {
    const api = this.messageApi;
    if (!api?.where) return null;
    return (await api.where({ whatsappId }).first()) ?? null;
  }

  /**
   * Prisma 8 `timestamptz` columns are driven by a Temporal codec: they accept
   * a `Temporal.Instant` and reject a `Date` outright. Writing a `Date` here
   * would fail at the driver with
   * `encodes a Temporal.Instant, but received a Date`, so every timestamp we
   * persist is converted at the last moment. The `Date` fallback keeps the
   * service usable in a plain Node process without the polyfill loaded.
   */
  private toInstant(at: Date): any {
    const T: any = (globalThis as any).Temporal;
    if (T?.Instant?.fromEpochMilliseconds) return T.Instant.fromEpochMilliseconds(at.getTime());
    return at;
  }
}
