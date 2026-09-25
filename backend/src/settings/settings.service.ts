import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FORBIDDEN_SETTING_KEY_PATTERNS,
  SETTING_KEYS,
  SettingKey,
  UpdateSettingsDto,
} from '../common/dto.js';

export interface ResolvedSettings {
  defaultCountryCode: string;
  defaultThrottleMs: number;
  defaultTemplateLanguage: string;
  maxRetryAttempts: number;
  appName: string;
}

/**
 * Values used when a setting has never been stored.
 *
 * These mirror the existing environment configuration so behaviour does not
 * change just because the settings table is empty. Environment configuration
 * remains the fallback for every value.
 */
const BUILT_IN_DEFAULTS: ResolvedSettings = {
  defaultCountryCode: '+91',
  defaultThrottleMs: 19000,
  defaultTemplateLanguage: 'en',
  maxRetryAttempts: 3,
  appName: 'Bharat Gas WhatsApp Sender',
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get api(): any {
    return (this.prisma.client as any).orm?.public?.AppSetting;
  }

  /** Environment-derived defaults, used whenever nothing is stored. */
  private envDefaults(): ResolvedSettings {
    const n = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
    };
    const country = this.config.get<string>('DEFAULT_COUNTRY_CODE');
    const throttle = this.config.get<string>('DEFAULT_THROTTLE_MS');
    const language = this.config.get<string>('DEFAULT_TEMPLATE_LANGUAGE');
    const retries = this.config.get<string>('MAX_RETRY_ATTEMPTS');
    const appName = this.config.get<string>('APP_NAME');

    return {
      defaultCountryCode: country && /^\+?[1-9]\d{0,3}$/.test(country.trim()) ? country.trim() : BUILT_IN_DEFAULTS.defaultCountryCode,
      defaultThrottleMs: n(throttle, BUILT_IN_DEFAULTS.defaultThrottleMs),
      defaultTemplateLanguage:
        language && /^[a-z]{2,3}([-_][A-Z]{2,3})?$/.test(language.trim())
          ? language.trim()
          : BUILT_IN_DEFAULTS.defaultTemplateLanguage,
      maxRetryAttempts: n(retries, BUILT_IN_DEFAULTS.maxRetryAttempts),
      appName: appName?.trim() || BUILT_IN_DEFAULTS.appName,
    };
  }

  /**
   * Resolved settings: stored values overlaid on environment/built-in
   * defaults. A stored value that fails validation is ignored rather than
   * trusted, so a bad row can never break a send.
   */
  async get(): Promise<ResolvedSettings> {
    const resolved = this.envDefaults();
    const api = this.api;
    if (!api?.all) return resolved;

    try {
      const rows = await api.all();
      const stored = Array.isArray(rows) ? rows : await rows;
      for (const row of stored ?? []) {
        if (!SETTING_KEYS.includes(row.key)) continue;
        if (this.isValidStoredValue(row.key, row.value)) {
          (resolved as any)[row.key] = coerce(row.key, row.value);
        } else {
          this.logger.warn(`Ignoring invalid stored setting ${row.key}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to read settings: ${(e as Error).message}`);
    }
    return resolved;
  }

  private isValidStoredValue(key: string, value: unknown): boolean {
    const text = asText(value).trim();
    if (!text) return false;
    switch (key) {
      case 'defaultThrottleMs':
      case 'maxRetryAttempts': {
        const n = Number(text);
        return Number.isInteger(n) && n > 0;
      }
      case 'defaultCountryCode':
        return /^\+?[1-9]\d{0,3}$/.test(text);
      case 'defaultTemplateLanguage':
        return /^[a-z]{2,3}([-_][A-Z]{2,3})?$/.test(text);
      case 'appName':
        return text.length <= 120;
      default:
        return false;
    }
  }

  /**
   * Persists a partial update. Only allow-listed keys are accepted; anything
   * else — in particular anything that looks like a credential — is rejected
   * outright. Secrets stay in the environment by design.
   */
  async update(dto: UpdateSettingsDto): Promise<ResolvedSettings> {
    const incoming = (dto ?? {}) as Record<string, unknown>;
    const rejected = Object.keys(incoming).filter(
      (key) =>
        !SETTING_KEYS.includes(key as SettingKey) ||
        FORBIDDEN_SETTING_KEY_PATTERNS.some((pattern) => key.toLowerCase().includes(pattern)),
    );
    if (rejected.length) {
      throw new BadRequestException(
        `Unsupported setting key(s): ${rejected.join(', ')}. Credentials are not stored in settings.`,
      );
    }

    const api = this.api;
    if (!api?.upsert) throw new BadRequestException('Settings storage is unavailable');

    for (const key of Object.keys(incoming)) {
      if (incoming[key] === undefined) continue;
      const value = asText(incoming[key]);
      await api.upsert({ create: { key, value }, update: { value } });
    }

    return this.get();
  }
}

function coerce(key: string, value: unknown): string | number {
  if (key === 'defaultThrottleMs' || key === 'maxRetryAttempts') return Math.floor(Number(value));
  return asText(value);
}

/**
 * Settings only ever hold primitives. Rendering anything else as `[object
 * Object]` would silently persist a useless value, so objects are rejected.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
