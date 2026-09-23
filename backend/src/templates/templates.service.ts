import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const VAR_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  constructor(private readonly prisma: PrismaService) {}

  private get api(): any {
    return (this.prisma.client as any).orm?.public?.MessageTemplate;
  }

  static extractVariables(body: string): string[] {
    const set = new Set<string>();
    let m: RegExpExecArray | null;
    const re = new RegExp(VAR_REGEX);
    while ((m = re.exec(body)) !== null) set.add(m[1]);
    return Array.from(set);
  }

  static extractTemplateParameters(body: string, values: Record<string, string>): string[] {
    const seen = new Set<string>();
    const params: string[] = [];
    const re = new RegExp(VAR_REGEX);
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const value = values[key];
      if (value !== undefined) params.push(value);
    }
    return params;
  }

  static render(body: string, values: Record<string, string>) {
    const missing: string[] = [];
    const rendered = body.replace(new RegExp(VAR_REGEX), (_, key: string) => {
      const v = values[key];
      if (v === undefined) { missing.push(key); return `{{${key}}}`; }
      return v;
    });
    return { rendered, missing };
  }

  private async insertOne(values: Record<string, any>): Promise<any> {
    const api = this.api;
    if (!api) throw new Error('MessageTemplate API not available');

    const tryCalls: Array<[string, () => Promise<any>]> = [
      ['createAll([values])', async () => {
        const res = await api.createAll([values]);
        const arr = Array.isArray(res) ? res : await res;
        if (Array.isArray(arr) && arr.length > 0) return arr[0];
        throw new Error('createAll returned no rows');
      }],
      ['insert(values)', async () => api.insert(values)],
      ['create(values)', async () => api.create(values)],
    ];

    for (const [name, call] of tryCalls) {
      try {
        const out = await call();
        if (out) { this.logger.log(`insert succeeded via ${name}`); return out; }
      } catch (e) {
        this.logger.warn(`${name} failed: ${(e as Error).message}`);
      }
    }
    throw new Error('All insert strategies failed');
  }

  private async updateOne(id: string, values: Record<string, any>): Promise<any> {
    const api = this.api;
    if (!api) throw new Error('MessageTemplate API not available');

    const tryCalls: Array<[string, () => Promise<any>]> = [
      ['where({id}).update(values)', async () => {
        const w = api.where({ id });
        if (!w || typeof w.update !== 'function') throw new Error('where().update not available');
        return w.update(values);
      }],
      ['update(id, values)', async () => api.update(id, values)],
      ['update({where,data})', async () => api.update({ where: { id }, data: values })],
    ];

    for (const [name, call] of tryCalls) {
      try {
        const out = await call();
        if (out) { this.logger.log(`update succeeded via ${name}`); return out; }
      } catch (e) {
        this.logger.warn(`${name} failed: ${(e as Error).message}`);
      }
    }
    throw new Error('All update strategies failed');
  }

  async create(dto: { name: string; body: string; description?: string; metaName?: string | null; metaLanguage?: string | null }) {
    if (!dto?.name?.trim()) throw new BadRequestException('name is required');
    if (!dto?.body?.trim()) throw new BadRequestException('body is required');

    const existing = await this.list();
    if (existing.some((t: any) => t.name === dto.name.trim())) {
      throw new BadRequestException(`Template name already exists: ${dto.name}`);
    }

    try {
      return await this.insertOne({
        name: dto.name.trim(),
        body: dto.body,
        description: dto.description ?? null,
        metaName: dto.metaName ?? null,
        metaLanguage: dto.metaLanguage ?? 'en',
      });
    } catch (e) {
      throw new BadRequestException('Create failed: ' + (e as Error).message);
    }
  }

  async list() {
    const api = this.api;
    if (!api?.all) return [];
    const res = await api.all();
    return Array.isArray(res) ? res : await res;
  }

  async findById(id: string) {
    const all = await this.list();
    return all.find((t: any) => t.id === id) ?? null;
  }

  async getById(id: string) {
    const t = await this.findById(id);
    if (!t) throw new NotFoundException(`Template ${id} not found`);
    return t;
  }

  async update(id: string, dto: any) {
    const existing = await this.getById(id);
    const values: Record<string, any> = {};
    if (dto.name !== undefined) values.name = dto.name.trim();
    if (dto.body !== undefined) values.body = dto.body;
    if (dto.description !== undefined) values.description = dto.description;
    if (dto.isActive !== undefined) values.isActive = dto.isActive;
    if (dto.metaName !== undefined) values.metaName = dto.metaName;
    if (dto.metaLanguage !== undefined) values.metaLanguage = dto.metaLanguage;

    try {
      const updated = await this.updateOne(id, values);
      return updated ?? { ...existing, ...values };
    } catch (e) {
      throw new BadRequestException('Update failed: ' + (e as Error).message);
    }
  }

  async archive(id: string) {
    return this.update(id, { isActive: false });
  }

  async preview(id: string, customerId: string) {
    const tpl = await this.getById(id);
    const allCust = await (this.prisma.client as any).orm?.public?.Customer.all();
    const customers = Array.isArray(allCust) ? allCust : await allCust;
    const customer = customers.find((c: any) => c.id === customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    const values: Record<string, string> = {
      customer_name: customer.name,
      mobile_no: customer.mobile,
      mobile: customer.mobile,
    };

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
      } catch {
        // Ignore malformed customer variables; the renderer will report missing variables.
      }
    }

    const { rendered, missing } = TemplatesService.render(tpl.body, values);
    return {
      template: { id: tpl.id, name: tpl.name },
      customer: { id: customer.id, name: customer.name, mobile: customer.mobile },
      variables: TemplatesService.extractVariables(tpl.body),
      missing,
      rendered,
    };
  }
}
