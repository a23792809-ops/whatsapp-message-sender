import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_COUNTRY_CODE = '91';

export type WhatsAppMode = 'dry' | 'text' | 'template';

export type WhatsAppApiError = {
  httpStatus?: number;
  code?: number;
  errorSubcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
  raw?: unknown;
};

export type SendResult = {
  ok: boolean;
  mode: WhatsAppMode;
  whatsappId?: string;
  error?: WhatsAppApiError | null;
  raw?: unknown;
  meta?: { template?: string; language?: string; parameterCount?: number };
};

export type TemplateComponent = {
  type: 'body' | 'header' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: Array<{ type: 'text'; text: string }>;
};

export type TextMessagePayload = { type: 'text'; body: string; previewUrl?: boolean };
export type TemplateMessagePayload = {
  type: 'template';
  name: string;
  language?: string;
  parameters?: string[];
  components?: TemplateComponent[];
};
export type MessagePayload = TextMessagePayload | TemplateMessagePayload;

export function normalizeE164(value: string, countryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) {
    digits = countryCode + digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = countryCode + digits.slice(1);
  }
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  get mode(): string {
    return (this.config.get<string>('WHATSAPP_MODE') || 'dry').toLowerCase();
  }

  get isConfigured(): boolean {
    return this.phoneNumberId.length > 0 && this.accessToken.length > 0;
  }

  isDryRun(): boolean {
    return this.mode !== 'live' || !this.isConfigured;
  }

  private get countryCode(): string {
    return this.config.get<string>('WHATSAPP_COUNTRY_CODE') || DEFAULT_COUNTRY_CODE;
  }

  private get apiVersion(): string {
    return this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
  }

  private get phoneNumberId(): string {
    return this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
  }

  private get accessToken(): string {
    return this.config.get<string>('WHATSAPP_ACCESS_TOKEN') || '';
  }

  private dryId(): string {
    return `dry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private invalidNumberError(mode: 'text' | 'template'): SendResult {
    return {
      ok: false,
      mode,
      error: {
        httpStatus: 400,
        code: 0,
        message: 'Invalid recipient phone number; expected an E.164 number (10-15 digits)',
      },
    };
  }

  private parseError(httpStatus: number, json: unknown): WhatsAppApiError {
    if (!json || typeof json !== 'object') {
      return { httpStatus, message: `HTTP ${httpStatus}` };
    }
    const body = json as Record<string, any>;
    const e = body?.error;
    if (e && typeof e === 'object') {
      return {
        httpStatus,
        code: typeof e.code === 'number' ? e.code : undefined,
        errorSubcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
        type: typeof e.type === 'string' ? e.type : undefined,
        message: typeof e.message === 'string' ? e.message : undefined,
        fbtraceId: typeof e.fbtrace_id === 'string' ? e.fbtrace_id : undefined,
        raw: json,
      };
    }
    return {
      httpStatus,
      message: typeof body?.message === 'string' ? body.message : `HTTP ${httpStatus}`,
      raw: json,
    };
  }

  private async postMessages(
    to: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; whatsappId?: string; error?: WhatsAppApiError | null; raw?: unknown }> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const error = this.parseError(res.status, json);
        this.logger.error(
          `WhatsApp API HTTP ${res.status} code=${error?.code ?? 'n/a'} message=${error?.message ?? 'n/a'}`,
        );
        return { ok: false, error, raw: json };
      }

      const wamid = json?.messages?.[0]?.id;
      this.logger.log(`WhatsApp API accepted message id=${wamid ?? 'n/a'}`);
      return { ok: true, whatsappId: typeof wamid === 'string' ? wamid : undefined, raw: json };
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`WhatsApp network error: ${message}`);
      return { ok: false, error: { httpStatus: 0, message } };
    }
  }

  async sendText(to: string, body: string, options: { previewUrl?: boolean } = {}): Promise<SendResult> {
    if (this.isDryRun()) {
      this.logger.log(`[DRY] text to ${to}: ${body.slice(0, 60)}...`);
      return { ok: true, mode: 'dry', whatsappId: this.dryId() };
    }

    const normalized = normalizeE164(to, this.countryCode);
    if (!normalized) return this.invalidNumberError('text');

    const res = await this.postMessages(normalized, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalized,
      type: 'text',
      text: { body, preview_url: options.previewUrl ?? false },
    });

    return { ok: res.ok, mode: 'text', whatsappId: res.whatsappId, error: res.error, raw: res.raw };
  }

  async sendTemplate(
    to: string,
    options: { name: string; language?: string; parameters?: string[]; components?: TemplateComponent[] },
  ): Promise<SendResult> {
    const language = options.language || this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') || 'en';
    const parameterCount = options.parameters?.length ?? 0;

    if (this.isDryRun()) {
      this.logger.log(`[DRY] template "${options.name}" (${language}) to ${to} with ${parameterCount} parameter(s)`);
      return {
        ok: true,
        mode: 'dry',
        whatsappId: this.dryId(),
        meta: { template: options.name, language, parameterCount },
      };
    }

    const normalized = normalizeE164(to, this.countryCode);
    if (!normalized) return this.invalidNumberError('template');

    const template: Record<string, any> = { name: options.name, language };
    if (options.components && options.components.length > 0) {
      template.components = options.components;
    } else if (parameterCount > 0) {
      template.components = [
        { type: 'body', parameters: options.parameters!.map((p) => ({ type: 'text', text: String(p) })) },
      ];
    }

    const res = await this.postMessages(normalized, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalized,
      type: 'template',
      template,
    });

    return {
      ok: res.ok,
      mode: 'template',
      whatsappId: res.whatsappId,
      error: res.error,
      raw: res.raw,
      meta: { template: options.name, language, parameterCount },
    };
  }

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    switch (message.type) {
      case 'text':
        return this.sendText(to, message.body, { previewUrl: message.previewUrl });
      case 'template':
        return this.sendTemplate(to, {
          name: message.name,
          language: message.language,
          parameters: message.parameters,
          components: message.components,
        });
    }
  }

  status() {
    return {
      mode: this.mode,
      dryRun: this.isDryRun(),
      configured: this.isConfigured,
      phoneNumberId: this.phoneNumberId ? '***set***' : 'missing',
      accessToken: this.accessToken ? '***set***' : 'missing',
      apiVersion: this.apiVersion,
      countryCode: this.countryCode,
    };
  }
}