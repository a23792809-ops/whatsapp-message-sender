import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { TemplatesService } from '../templates/templates.service.js';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly templates: TemplatesService,
  ) {}

  private get messageApi(): any {
    return (this.prisma.client as any).orm?.public?.Message;
  }
  private get customerApi(): any {
    return (this.prisma.client as any).orm?.public?.Customer;
  }

  // Prisma 8 timestamptz columns require Temporal.Instant, not Date.
  private now(): any {
    const T: any = (globalThis as any).Temporal;
    if (T?.Now?.instant) return T.Now.instant();
    return new Date();
  }

  private async updateOne(api: any, id: string, values: Record<string, any>): Promise<any> {
    const attempts: Array<[string, () => Promise<any>]> = [
      ['where({id}).update(v)', () => api.where({ id }).update(values)],
      ['update(id, v)', () => api.update(id, values)],
      ['update({where,data})', () => api.update({ where: { id }, data: values })],
      ['update({id},v)', () => api.update({ id }, values)],
    ];
    for (const [name, fn] of attempts) {
      try {
        const out = await fn();
        if (out) { this.logger.log(`update OK via ${name}`); return out; }
      } catch (e) {
        this.logger.warn(`update ${name}: ${(e as Error).message}`);
      }
    }
    throw new Error('All update strategies failed');
  }

  private async insertMessage(values: Record<string, any>): Promise<any> {
    const api = this.messageApi;
    if (!api?.createAll) throw new Error('Message.createAll unavailable');
    const res = await api.createAll([values]);
    const arr = Array.isArray(res) ? res : await res;
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('createAll returned empty');
    return arr[0];
  }

  async send(customerId: string, templateId: string) {
    if (!customerId) throw new BadRequestException('customerId is required');
    if (!templateId) throw new BadRequestException('templateId is required');

    const customers = await (await this.customerApi.all());
    const customer = customers.find((c: any) => c.id === customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    const tpl = await this.templates.getById(templateId);

    const values: Record<string, string> = {
      customer_name: customer.name,
      mobile_no: customer.mobile,
      mobile: customer.mobile,
    };

    // Merge imported custom variables (same logic as template preview / campaign engine).
    if (customer.variables) {
      try {
        const custom = JSON.parse(customer.variables);
        if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
          for (const [key, value] of Object.entries(custom)) {
            if (value !== undefined && value !== null) {
              values[key] = String(value);
            }
          }
        }
      } catch (e) {
        this.logger.warn(
          `Invalid customer.variables JSON for ${customer.id}: ${(e as Error).message}`,
        );
      }
    }

    const { rendered, missing } = TemplatesService.render(tpl.body, values);

    // Never send a message containing unresolved template variables.
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot send to ${customer.name} (+${customer.mobile}): missing required template variable(s): ${missing.join(
          ', ',
        )}. Update this customer's data or choose a different template.`,
      );
    }

    const result = await this.wa.sendText(customer.mobile, rendered);
    const status = result.ok ? 'SENT' : 'FAILED';

    const message = await this.insertMessage({
      customerId: customer.id,
      campaignId: null,
      mobile: customer.mobile,
      customerName: customer.name,
      content: rendered,
      status,
      whatsappId: result.whatsappId ?? null,
      error: result.error ?? null,
      sentAt: result.ok ? this.now() : null,
    });

    try {
      await this.updateOne(this.customerApi, customer.id, {
        status,
        lastAttempt: this.now(),
      });
    } catch (e) {
      this.logger.warn(`Customer status update failed: ${(e as Error).message}`);
    }

    return {
      ok: result.ok,
      mode: result.mode,
      messageId: message?.id,
      whatsappId: result.whatsappId,
      status,
      error: result.error,
      renderedPreview: rendered.slice(0, 200),
      missingVariables: missing,
    };
  }

  async list(limit = 100) {
    const api = this.messageApi;
    if (!api?.all) return [];
    const q = typeof api.limit === 'function' ? api.limit(limit) : api;
    const res = await q.all();
    const arr = Array.isArray(res) ? res : await res;
    return arr;
  }
}
