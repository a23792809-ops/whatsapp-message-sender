import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditEntityType, AuditStatus } from '../audit/audit.types.js';
import { PAGE_SIZE_MAX } from './pagination.js';

const ISO_LANGUAGE_PATTERN = /^[a-z]{2,3}([-_][A-Z]{2,3})?$/;

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  metaName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'metaLanguage must be an ISO language code (e.g. en, hi)' })
  metaLanguage?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  metaName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'metaLanguage must be an ISO language code (e.g. en, hi)' })
  metaLanguage?: string;
}

export class PreviewTemplateDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  customerIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600_000)
  throttleMs?: number;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;
}

export class TestSendDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s()-]{9,18}$/, { message: 'to must be a valid phone number' })
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  templateName?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'language must be an ISO language code (e.g. en, hi)' })
  language?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  parameters?: string[];
}
/* ------------------------------------------------------------------ */
/* Audit log                                                          */
/* ------------------------------------------------------------------ */

export class AuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  pageSize?: number;

  @IsOptional()
  @IsIn(Object.values(AuditAction))
  action?: string;

  @IsOptional()
  @IsIn(Object.values(AuditEntityType))
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @IsOptional()
  @IsIn(Object.values(AuditStatus))
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class MessageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerId?: string;
}

/* ------------------------------------------------------------------ */
/* Application settings                                               */
/* ------------------------------------------------------------------ */

/**
 * Setting keys the API accepts. This allow-list is the mechanism that keeps
 * secrets out of the settings table: a key that is not listed cannot be
 * written, regardless of what the request body contains.
 */
export const SETTING_KEYS = [
  'defaultCountryCode',
  'defaultThrottleMs',
  'defaultTemplateLanguage',
  'maxRetryAttempts',
  'appName',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Substrings that may never appear in a settings key. */
export const FORBIDDEN_SETTING_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'credential',
  'apikey',
  'api_key',
  'authorization',
  'private',
  'accesskey',
] as const;

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{0,3}$/, { message: 'defaultCountryCode must be a 1-4 digit country code, optionally prefixed with +' })
  @MaxLength(5)
  defaultCountryCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600_000)
  defaultThrottleMs?: number;

  @IsOptional()
  @Matches(ISO_LANGUAGE_PATTERN, { message: 'defaultTemplateLanguage must be an ISO language code (e.g. en, hi)' })
  defaultTemplateLanguage?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxRetryAttempts?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  appName?: string;
}
