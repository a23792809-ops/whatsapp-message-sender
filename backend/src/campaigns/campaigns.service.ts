import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { TemplatesService } from '../templates/templates.service.js';

type EngineState = {
  paused: boolean;
  stopped: boolean;
  running: boolean;
};

const RUNNABLE_STATUSES = ['DRAFT', 'QUEUED', 'PAUSED'];
const MAX_ATTEMPTS = 3;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private readonly engines = new Map<string, EngineState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsAppService,
    private readonly templates: TemplatesService,
  ) {}

  private get campaignApi(): any {
    return (this.prisma.client as any).orm?.public?.Campaign;
  }
  private get messageApi(): any {
    return (this.prisma.client as any).orm?.public?.Message;
  }
  private get customerApi(): any {
    return (this.prisma.client as any).orm?.public?.Customer;
  }

  async onApplicationBootstrap() {
    try {
      const result = await this.recoverRunning();
      if (result.recovered.length > 0) {
        this.logger.log(`Recovered campaign runner(s): ${result.recovered.join(', ')}`);
      }
    } catch (e) {
      this.logger.error(`Campaign recovery failed: ${(e as Error).message}`);
    }
  }

  /**
   * Claim a live in-memory runner for a campaign. Synchronous so concurrent
   * start/resume/recovery calls can never spawn two runners for the same id.
   * Returns false when a runner is already active.
   */
  private claimRunner(id: string): boolean {
    const existing = this.engines.get(id);
    if (existing?.running) return false;
    this.engines.set(id, { paused: false, stopped: false, running: true });
    return true;
  }

  private launch(id: string) {
    const state = this.engines.get(id);
    if (!state) return;
    void this.runLoop(id, state).catch((e) => {
      this.logger.error(`Campaign ${id} loop crashed: ${(e as Error).message}`);
    });
  }

  /**
   * Pick up campaigns persisted as RUNNING before a restart and attach a
   * runner to each one that does not already have a live runner. PAUSED and
   * STOPPED campaigns are intentionally left untouched.
   */
  async recoverRunning(): Promise<{ recovered: string[]; skipped: string[] }> {
    const api = this.campaignApi;
    if (!api?.all) return { recovered: [], skipped: [] };
    const all = await api.all();
    const arr = Array.isArray(all) ? all : await all;
    const recovered: string[] = [];
    const skipped: string[] = [];
    for (const c of arr) {
      if (c.status !== 'RUNNING') continue;
      if (this.claimRunner(c.id)) {
        this.launch(c.id);
        recovered.push(c.id);
      } else {
        skipped.push(c.id);
      }
    }
    return { recovered, skipped };
  }

  private now(): any {
    const T: any = (globalThis as any).Temporal;
    if (T?.Now?.instant) return T.Now.instant();
    return new Date();
  }

  private async updateCampaign(id: string, values: Record<string, any>) {
    return this.campaignApi.where({ id }).update(values);
  }

  private async updateMessage(id: string, values: Record<string, any>) {
    return this.messageApi.where({ id }).update(values);
  }

  private async findCampaign(id: string) {
    const all = await this.campaignApi.all();
    const arr = Array.isArray(all) ? all : await all;
    return arr.find((c: any) => c.id === id) ?? null;
  }

  private async getCampaignOrThrow(id: string) {
    const c = await this.findCampaign(id);
    if (!c) throw new NotFoundException(`Campaign ${id} not found`);
    return c;
  }

  private async messagesFor(campaignId: string, status?: string) {
    const all = await this.messageApi.all();
    const arr = Array.isArray(all) ? all : await all;
    return arr.filter((m: any) => m.campaignId === campaignId && (!status || m.status === status));
  }

  async create(dto: { name: string; templateId: string; customerIds: string[]; throttleMs?: number }) {
    if (!dto?.name?.trim()) throw new BadRequestException('name is required');
    if (!dto?.templateId) throw new BadRequestException('templateId is required');
    if (!Array.isArray(dto.customerIds) || dto.customerIds.length === 0) {
      throw new BadRequestException('customerIds must be a non-empty array');
    }

    // validate template exists
    await this.templates.getById(dto.templateId);

    // validate + load customers
    const allCustomers = await this.customerApi.all();
    const customers = Array.isArray(allCustomers) ? allCustomers : await allCustomers;
    const byId = new Map(customers.map((c: any) => [c.id, c]));
    const missing = dto.customerIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown customer IDs: ${missing.join(', ')}`);
    }

    const throttleMs = dto.throttleMs && dto.throttleMs >= 5000 ? dto.throttleMs : 19000;

    const campaignRes = await this.campaignApi.createAll([{
      name: dto.name.trim(),
      status: 'DRAFT',
      templateId: dto.templateId,
      throttleMs,
      total: dto.customerIds.length,
      sent: 0,
      failed: 0,
      pending: dto.customerIds.length,
    }]);
    const campaignArr = Array.isArray(campaignRes) ? campaignRes : await campaignRes;
    const campaign = campaignArr[0];

    const messageRows = dto.customerIds.map((cid) => {
      const cust: any = byId.get(cid);
      return {
        customerId: cust.id,
        campaignId: campaign.id,
        mobile: cust.mobile,
        customerName: cust.name,
        content: '',
        status: 'PENDING',
        attemptCount: 0,
      };
    });
    await this.messageApi.createAll(messageRows);

    return campaign;
  }

  async list() {
    const all = await this.campaignApi.all();
    return Array.isArray(all) ? all : await all;
  }

  async getById(id: string) {
    return this.getCampaignOrThrow(id);
  }

  async progress(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    const messages = await this.messagesFor(id);
    const sent = messages.filter((m: any) => m.status === 'SENT').length;
    const failed = messages.filter((m: any) => m.status === 'FAILED').length;
    const pending = messages.filter((m: any) => m.status === 'PENDING').length;
    const total = messages.length;
    return {
      campaignId: id,
      status: campaign.status,
      total,
      sent,
      failed,
      pending,
      percentage: total > 0 ? Math.round(((sent + failed) / total) * 100) : 0,
    };
  }

  async start(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    if (!RUNNABLE_STATUSES.includes(campaign.status)) {
      throw new BadRequestException(`Cannot start campaign in status ${campaign.status}`);
    }

    if (!this.claimRunner(id)) {
      throw new BadRequestException('Campaign is already running');
    }

    await this.updateCampaign(id, { status: 'RUNNING' });

    // run in background, do not await
    this.launch(id);

    return { ok: true, status: 'RUNNING' };
  }

  async pause(id: string) {
    const state = this.engines.get(id);
    if (!state || !state.running) {
      // Reliability: a RUNNING campaign whose runner is no longer alive (e.g.
      // it crashed after a restart) must still be pausable from the database.
      const campaign = await this.findCampaign(id);
      if (campaign?.status === 'RUNNING') {
        this.engines.delete(id);
        await this.updateCampaign(id, { status: 'PAUSED' });
        return { ok: true, status: 'PAUSED' };
      }
      throw new BadRequestException('Campaign is not running');
    }
    state.paused = true;
    await this.updateCampaign(id, { status: 'PAUSED' });
    return { ok: true, status: 'PAUSED' };
  }

  async resume(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    if (campaign.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume campaign in status ${campaign.status}`);
    }
    return this.start(id);
  }

  async stop(id: string) {
    const state = this.engines.get(id);
    if (state) {
      state.stopped = true;
      state.paused = false;
    }
    await this.updateCampaign(id, { status: 'STOPPED' });
    return { ok: true, status: 'STOPPED' };
  }

  async retryFailed(id: string) {
    const failedMessages = await this.messagesFor(id, 'FAILED');
    if (failedMessages.length === 0) {
      return { ok: true, retried: 0 };
    }
    for (const m of failedMessages) {
      await this.updateMessage(m.id, { status: 'PENDING', error: null });
    }
    await this.updateCampaign(id, { status: 'QUEUED' });
    return { ok: true, retried: failedMessages.length };
  }

  private async runLoop(campaignId: string, state: EngineState) {
    try {
      const campaign = await this.getCampaignOrThrow(campaignId);
      const tpl = await this.templates.getById(campaign.templateId);
      const throttleMs = campaign.throttleMs || 19000;

      while (true) {
        if (state.stopped) {
          this.logger.log(`Campaign ${campaignId} stopped`);
          break;
        }
        if (state.paused) {
          this.logger.log(`Campaign ${campaignId} paused`);
          break;
        }

        const pending = await this.messagesFor(campaignId, 'PENDING');
        if (pending.length === 0) {
          const messages = await this.messagesFor(campaignId);
          const sent = messages.filter((m: any) => m.status === 'SENT').length;
          const failed = messages.filter((m: any) => m.status === 'FAILED').length;
          const stillPending = messages.filter((m: any) => m.status === 'PENDING').length;
          await this.updateCampaign(campaignId, {
            status: 'COMPLETED',
            sent,
            failed,
            pending: stillPending,
          });
          this.logger.log(`Campaign ${campaignId} completed`);
          break;
        }

        const msg = pending[0];

        // Build template variables from the customer record.
        // The customer.variables field contains additional columns
        // imported from the CSV/XLSX row as JSON.
        const customer = await (async () => {
          const all = await this.customerApi.all();
          const arr = Array.isArray(all) ? all : await all;
          return arr.find((c: any) => c.id === msg.customerId) ?? null;
        })();

        if (!customer) {
          await this.updateMessage(msg.id, {
            status: 'FAILED',
            error: 'Customer record not found',
            attemptCount: (msg.attemptCount || 0) + 1,
          });

          const c = await this.getCampaignOrThrow(campaignId);
          await this.updateCampaign(campaignId, {
            failed: (c.failed || 0) + 1,
            pending: Math.max(0, (c.pending || 0) - 1),
          });

          continue;
        }

        const values: Record<string, string> = {
          customer_name: msg.customerName,
          mobile_no: msg.mobile,
          mobile: msg.mobile,
        };

        // Merge imported custom variables.
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
            this.logger.warn(`Invalid customer.variables JSON for ${msg.customerId}`);
          }
        }

        const { rendered, missing } = TemplatesService.render(tpl.body, values);

        // Never send an unresolved template variable.
        if (missing.length > 0) {
          const newAttemptCount = (msg.attemptCount || 0) + 1;

          await this.updateMessage(msg.id, {
            content: rendered,
            status: 'FAILED',
            error: `Missing template variables: ${missing.join(', ')}`,
            attemptCount: newAttemptCount,
          });

          const c = await this.getCampaignOrThrow(campaignId);
          await this.updateCampaign(campaignId, {
            failed: (c.failed || 0) + 1,
            pending: Math.max(0, (c.pending || 0) - 1),
          });

          this.logger.warn(
            `Campaign ${campaignId}: message ${msg.id} blocked because variables are missing: ${missing.join(', ')}`,
          );

          continue;
        }

        // Store the final personalized content before attempting delivery.
        await this.updateMessage(msg.id, {
          content: rendered,
        });

        const result = tpl.metaName
          ? await this.wa.sendTemplate(msg.mobile, {
              name: tpl.metaName,
              language: tpl.metaLanguage || 'en',
              parameters: TemplatesService.extractTemplateParameters(tpl.body, values),
            })
          : await this.wa.sendText(msg.mobile, rendered);
        const newAttemptCount = (msg.attemptCount || 0) + 1;

        if (result.ok) {
          await this.updateMessage(msg.id, {
            content: rendered,
            status: 'SENT',
            whatsappId: result.whatsappId ?? null,
            error: null,
            attemptCount: newAttemptCount,
            sentAt: this.now(),
          });
          const c = await this.getCampaignOrThrow(campaignId);
          await this.updateCampaign(campaignId, {
            sent: (c.sent || 0) + 1,
            pending: Math.max(0, (c.pending || 0) - 1),
          });
        } else {
          const permanentFail = newAttemptCount >= MAX_ATTEMPTS;
          await this.updateMessage(msg.id, {
            content: rendered,
            status: permanentFail ? 'FAILED' : 'PENDING',
            error: result.error ?? 'unknown error',
            attemptCount: newAttemptCount,
          });
          if (permanentFail) {
            const c = await this.getCampaignOrThrow(campaignId);
            await this.updateCampaign(campaignId, {
              failed: (c.failed || 0) + 1,
              pending: Math.max(0, (c.pending || 0) - 1),
            });
          }
        }

        await this.sleep(throttleMs);
      }
    } catch (e) {
      this.logger.error(`Campaign ${campaignId} loop crashed: ${(e as Error).message}`);
    } finally {
      // Always release the runner claim, even on crashes, so the campaign can
      // be recovered/paused again instead of being stuck as "running" forever.
      state.running = false;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
