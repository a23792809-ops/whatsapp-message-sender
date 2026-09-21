import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendResult = {
  ok: boolean;
  mode: 'dry' | 'text' | 'template';
  whatsappId?: string;
  error?: string;
  raw?: unknown;
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  get mode(): string {
    return (this.config.get<string>('WHATSAPP_MODE') || 'dry').toLowerCase();
  }

  get isConfigured(): boolean {
    const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN') || '';
    return phoneId.length > 0 && token.length > 0;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const mode = this.mode;

    if (mode === 'dry' || !this.isConfigured) {
      this.logger.log(`[DRY] would send to ${to}: ${body.slice(0, 60)}...`);
      return {
        ok: true,
        mode: 'dry',
        whatsappId: `dry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      };
    }

    const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!;
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')!;
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body, preview_url: false },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = json?.error?.message || `HTTP ${res.status}`;
        this.logger.error(`WhatsApp send failed: ${errMsg}`);
        return { ok: false, mode: 'text', error: errMsg, raw: json };
      }

      const wamid = json?.messages?.[0]?.id;
      this.logger.log(`WhatsApp sent OK: ${wamid}`);
      return { ok: true, mode: 'text', whatsappId: wamid, raw: json };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`WhatsApp network error: ${msg}`);
      return { ok: false, mode: 'text', error: msg };
    }
  }

  status() {
    return {
      mode: this.mode,
      configured: this.isConfigured,
      phoneNumberId: this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') ? '***set***' : 'missing',
      accessToken: this.config.get<string>('WHATSAPP_ACCESS_TOKEN') ? '***set***' : 'missing',
      apiVersion: this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0',
    };
  }
}
