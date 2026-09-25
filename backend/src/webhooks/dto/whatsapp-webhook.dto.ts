import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Shape of the Meta WhatsApp Cloud API webhook payload we consume.
 *
 * Two deliberate choices:
 *
 *  - Every field is optional. Meta adds fields over time and sends payloads for
 *    events we do not care about (inbound messages, message echoes, account
 *    updates). Validating them as "required" would turn a harmless event into a
 *    4xx, and Meta retries 4xx — so an irrelevant payload must still be a 200.
 *  - Nothing here is `@IsNotEmpty`/required, and the global `whitelist` strips
 *    unknown keys rather than rejecting them, so a future Meta field cannot
 *    break ingestion. This is the "do not throw on unknown event fields" rule.
 *
 * Bounds are still enforced on everything we do read, so a hostile or
 * malformed payload cannot be used to push unbounded data through the service.
 */

/** Meta message ids look like `wamid.HBgNNTUxMTk5OTk5OTk5ORUCABEYEjg0...`. */
const WHATSAPP_ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;

/** Unix epoch seconds, as Meta sends it (sometimes as a numeric string). */
const EPOCH_SECONDS_PATTERN = /^\d{1,13}$/;

export class WhatsAppWebhookErrorDto {
  @IsOptional()
  @IsInt()
  code?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

/** One delivery-state event for a single outbound message. */
export class WhatsAppWebhookStatusDto {
  /** The Meta message id. This is what we match `Message.whatsappId` against. */
  @IsOptional()
  @IsString()
  @Matches(WHATSAPP_ID_PATTERN)
  id?: string;

  /** Recipient, as Meta reports it. Never trusted as an identity. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recipient_id?: string;

  /** `sent` | `delivered` | `read` | `failed` | `deleted` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  /** Unix epoch seconds of the event according to Meta. */
  @IsOptional()
  @Matches(EPOCH_SECONDS_PATTERN)
  timestamp?: string;

  @IsOptional()
  @IsObject()
  conversation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pricing?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookErrorDto)
  errors?: WhatsAppWebhookErrorDto[];

  /**
   * Inbound message echoes and other event families. Present so a payload
   * containing them still validates; we never read them.
   */
  @IsOptional()
  @IsObject()
  message?: Record<string, unknown>;
}

export class WhatsAppWebhookValueDto {
  /**
   * Meta sends this as the literal string "whatsapp", not an object. Typed as
   * a string deliberately: validating it as an object would reject every real
   * payload with a 400, and Meta retries 4xx.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  messaging_product?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookStatusDto)
  statuses?: WhatsAppWebhookStatusDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookStatusDto)
  messages?: WhatsAppWebhookStatusDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookErrorDto)
  errors?: WhatsAppWebhookErrorDto[];
}

export class WhatsAppWebhookChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  field?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppWebhookValueDto)
  value?: WhatsAppWebhookValueDto;
}

export class WhatsAppWebhookEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookChangeDto)
  changes?: WhatsAppWebhookChangeDto[];
}

export class WhatsAppWebhookDto {
  /** Always `whatsapp_business_account` for us, but not enforced. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  object?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppWebhookEntryDto)
  entry?: WhatsAppWebhookEntryDto[];
}
