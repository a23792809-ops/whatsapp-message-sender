import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { TemplatesService } from '../templates/templates.service.js';

const MAX_ATTEMPTS = 3;
const DEFAULT_THROTTLE_MS = 19000;
const MIN_THROTTLE_MS = 5000;

const STATUS = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const MESSAGE_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;

/**
 * Statuses that mean "WhatsApp has accepted this message".
 *
 * The webhook pipeline advances a row past SENT to DELIVERED and then READ, so
 * the campaign engine must keep treating those states as work successfully
 * completed. Otherwise a delivery webhook would make a finished campaign look
 * unstarted again: the row would fall back into the pending bucket and the
 * campaign could never complete.
 */
const ACCEPTED_MESSAGE_STATUSES: readonly string[] = [
  MESSAGE_STATUS.SENT,
  MESSAGE_STATUS.DELIVERED,
  MESSAGE_STATUS.READ,
];

/**
 * The only campaign status changes the engine will perform. Any move that is
 * absent here is rejected, which is what keeps nonsensical transitions out
 * (COMPLETED -> RUNNING, STOPPED -> PAUSED, RUNNING -> DRAFT, …).
 *
 * QUEUED is the "ready to start again" state produced by
 * POST /campaigns/:id/retry. The campaign UI treats DRAFT and QUEUED
 * identically, so both are startable; STOPPED, COMPLETED and FAILED are
 * terminal except for that explicit retry back into QUEUED.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  [STATUS.DRAFT]: [STATUS.RUNNING],
  [STATUS.QUEUED]: [STATUS.RUNNING],
  [STATUS.RUNNING]: [STATUS.PAUSED, STATUS.STOPPED, STATUS.COMPLETED, STATUS.FAILED],
  [STATUS.PAUSED]: [STATUS.RUNNING, STATUS.STOPPED],
  [STATUS.STOPPED]: [STATUS.QUEUED],
  [STATUS.COMPLETED]: [STATUS.QUEUED],
  [STATUS.FAILED]: [STATUS.QUEUED],
};

/** Counters persisted on Campaign, always derived from the real message rows. */
type CampaignCounters = { total: number; sent: number; failed: number; pending: number };

/**
 * Everything the runner needs about the campaign it is executing. The template
 * row is loaded once for the whole run: `TemplatesService.getById` reads the
 * entire template table, so re-fetching it per message would be a full scan on
 * every send.
 */
type CampaignRun = {
  campaignId: string;
  throttleMs: number;
  template: { body: string; metaName?: string | null; metaLanguage?: string | null };
};

/**
 * A live runner claim for one campaign. The object identity matters: a runner
 * only releases the claim in `this.engines` while it is still the registered
 * state, so a pause/resume pair that swaps in a fresh state object cannot have
 * its new runner torn down by the old loop's `finally` block.
 */
type EngineState = {
  paused: boolean;
  stopped: boolean;
  running: boolean;
  /** Resolves the in-flight throttle sleep early; null when not sleeping. */
  wake: (() => void) | null;
};

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

  // ---------------------------------------------------------------- lifecycle

  /**
   * Claim a live in-memory runner for a campaign. Synchronous, so concurrent
   * start/resume/recovery calls can never spawn two runners for the same id.
   *
   * A paused loop is winding down and only ever reads its own (now stale)
   * state, so replacing it is safe — and it is what lets `resume()` work
   * immediately after `pause()` without waiting for the old loop to unwind.
   * Returns false when a live, unpaused runner already owns the campaign.
   */
  private claimRunner(id: string): boolean {
    const existing = this.engines.get(id);
    if (existing && existing.running && !existing.paused) return false;
    this.engines.set(id, { paused: false, stopped: false, running: true, wake: null });
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
   * runner to each one that does not already have a live runner. Every other
   * status is intentionally left untouched.
   */
  async recoverRunning(): Promise<{ recovered: string[]; skipped: string[] }> {
    const api = this.campaignApi;
    if (!api?.where) return { recovered: [], skipped: [] };
    const rows = await api.where((c: any) => c.status.eq(STATUS.RUNNING)).all();
    const campaigns = Array.isArray(rows) ? rows : [];
    const recovered: string[] = [];
    const skipped: string[] = [];
    for (const c of campaigns) {
      if (this.claimRunner(c.id)) {
        this.launch(c.id);
        recovered.push(c.id);
      } else {
        skipped.push(c.id);
      }
    }
    return { recovered, skipped };
  }

  // ------------------------------------------------------------- persistence

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
    if (!this.campaignApi?.where) return null;
    return (await this.campaignApi.where({ id }).first()) ?? null;
  }

  private async getCampaignOrThrow(id: string) {
    const c = await this.findCampaign(id);
    if (!c) throw new NotFoundException(`Campaign ${id} not found`);
    return c;
  }

  private assertTransition(from: string, to: string) {
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Cannot change campaign from ${from} to ${to}`);
    }
  }

  /**
   * Derive the campaign counters from the message rows themselves rather than
   * incrementing stored numbers, so counters cannot drift away from reality
   * after a crash, a restart, or a manual retry. One grouped aggregate, always
   * scoped to this campaign, so messages belonging to another campaign (or to
   * no campaign at all) are never counted.
   */
  private async computeCounters(campaignId: string): Promise<CampaignCounters> {
    const counters: CampaignCounters = { total: 0, sent: 0, failed: 0, pending: 0 };
    const rows = await this.messageApi
      .where({ campaignId })
      .groupBy('status')
      .aggregate((a: any) => ({ n: a.count() }));

    for (const row of Array.isArray(rows) ? rows : []) {
      const n = typeof row.n === 'number' ? row.n : 0;
      counters.total += n;
      if (ACCEPTED_MESSAGE_STATUSES.includes(row.status)) counters.sent += n;
      else if (row.status === MESSAGE_STATUS.FAILED) counters.failed += n;
      else counters.pending += n;
    }
    return counters;
  }

  /** Recompute counters from message state and persist them. */
  private async syncCounters(campaignId: string): Promise<CampaignCounters> {
    const counters = await this.computeCounters(campaignId);
    await this.updateCampaign(campaignId, { ...counters });
    return counters;
  }

  // -------------------------------------------------------------- public API

  async create(dto: { name: string; templateId: string; customerIds: string[]; throttleMs?: number }) {
    if (!dto?.name?.trim()) throw new BadRequestException('name is required');
    if (!dto?.templateId) throw new BadRequestException('templateId is required');
    if (!Array.isArray(dto.customerIds) || dto.customerIds.length === 0) {
      throw new BadRequestException('customerIds must be a non-empty array');
    }

    // validate template exists
    await this.templates.getById(dto.templateId);

    // A duplicated customer id would otherwise queue the same recipient twice
    // and make the counters disagree with the message rows.
    const customerIds = Array.from(new Set(dto.customerIds));

    // Validate + load only the requested customers rather than the whole table.
    const loaded = await this.customerApi.where((c: any) => c.id.in(customerIds)).all();
    const customers = Array.isArray(loaded) ? loaded : [];
    const byId = new Map(customers.map((c: any) => [c.id, c]));
    const missing = customerIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown customer IDs: ${missing.join(', ')}`);
    }

    const throttleMs = dto.throttleMs && dto.throttleMs >= MIN_THROTTLE_MS ? dto.throttleMs : DEFAULT_THROTTLE_MS;

    const campaignRes = await this.campaignApi.createAll([{
      name: dto.name.trim(),
      status: STATUS.DRAFT,
      templateId: dto.templateId,
      throttleMs,
      total: customerIds.length,
      sent: 0,
      failed: 0,
      pending: customerIds.length,
    }]);
    const campaignArr = Array.isArray(campaignRes) ? campaignRes : await campaignRes;
    const campaign = campaignArr[0];

    const messageRows = customerIds.map((cid) => {
      const cust: any = byId.get(cid);
      return {
        customerId: cust.id,
        campaignId: campaign.id,
        mobile: cust.mobile,
        customerName: cust.name,
        content: '',
        status: MESSAGE_STATUS.PENDING,
        attemptCount: 0,
      };
    });
    await this.messageApi.createAll(messageRows);

    return campaign;
  }

  async list() {
    const rows = await this.campaignApi
      .orderBy([(c: any) => c.createdAt.desc(), (c: any) => c.id.desc()])
      .all();
    return Array.isArray(rows) ? rows : [];
  }

  async getById(id: string) {
    return this.getCampaignOrThrow(id);
  }

  /**
   * Progress is computed from the message rows on every call, so it is always
   * consistent with the database even while a runner holds the campaign row's
   * counters mid-update. Response shape is unchanged for the campaign UI.
   */
  async progress(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    const { total, sent, failed, pending } = await this.computeCounters(id);
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
    this.assertTransition(campaign.status, STATUS.RUNNING);

    if (!this.claimRunner(id)) {
      throw new BadRequestException('Campaign is already running');
    }

    await this.updateCampaign(id, { status: STATUS.RUNNING });

    // run in background, do not await
    this.launch(id);

    return { ok: true, status: STATUS.RUNNING };
  }

  async pause(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    this.assertTransition(campaign.status, STATUS.PAUSED);

    // A campaign persisted as RUNNING whose runner is no longer alive (e.g. it
    // crashed after a restart) is still pausable straight from the database.
    const state = this.engines.get(id);
    if (state) {
      state.paused = true;
      this.wake(state);
    }

    await this.updateCampaign(id, { status: STATUS.PAUSED });
    await this.syncCounters(id);
    return { ok: true, status: STATUS.PAUSED };
  }

  async resume(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    if (campaign.status !== STATUS.PAUSED) {
      throw new BadRequestException(`Cannot resume campaign in status ${campaign.status}`);
    }
    return this.start(id);
  }

  async stop(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    this.assertTransition(campaign.status, STATUS.STOPPED);

    const state = this.engines.get(id);
    if (state) {
      state.stopped = true;
      state.paused = false;
      this.wake(state);
    }

    await this.updateCampaign(id, { status: STATUS.STOPPED });
    await this.syncCounters(id);
    return { ok: true, status: STATUS.STOPPED };
  }

  /**
   * Re-queue the campaign's permanently failed messages for another delivery
   * round. This is an explicit operator action, so it grants a fresh
   * MAX_ATTEMPTS budget; the engine's own automatic ceiling is untouched.
   * Completed messages are never touched, so a campaign is never re-sent to a
   * recipient that already received it.
   */
  async retryFailed(id: string) {
    const campaign = await this.getCampaignOrThrow(id);
    const rows = await this.messageApi
      .where({ campaignId: id })
      .where((m: any) => m.status.eq(MESSAGE_STATUS.FAILED))
      .orderBy([(m: any) => m.createdAt.asc(), (m: any) => m.id.asc()])
      .all();
    const failedMessages = Array.isArray(rows) ? rows : [];

    if (failedMessages.length === 0) {
      return { ok: true, retried: 0 };
    }

    for (const m of failedMessages) {
      await this.updateMessage(m.id, { status: MESSAGE_STATUS.PENDING, attemptCount: 0, error: null });
    }

    // A live runner picks the re-queued messages up on its next pass, so a
    // RUNNING campaign must not be dragged back to QUEUED underneath it.
    if (campaign.status !== STATUS.RUNNING && campaign.status !== STATUS.QUEUED) {
      this.assertTransition(campaign.status, STATUS.QUEUED);
      await this.updateCampaign(id, { status: STATUS.QUEUED });
    }

    await this.syncCounters(id);
    return { ok: true, retried: failedMessages.length };
  }

  // --------------------------------------------------------------- execution

  /** Why the loop must stop right now, or null while it may keep working. */
  private haltReason(state: EngineState): 'stopped' | 'paused' | null {
    if (state.stopped) return 'stopped';
    if (state.paused) return 'paused';
    return null;
  }

  private wake(state: EngineState) {
    const wake = state.wake;
    state.wake = null;
    if (wake) wake();
  }

  /**
   * The single next message this campaign is allowed to work on: PENDING only,
   * this campaign only, oldest first with the id as a stable tie-breaker so a
   * campaign always drains in the same order. One bounded, indexed row — never
   * the whole message table.
   */
  private async nextPendingMessage(campaignId: string) {
    const rows = await this.messageApi
      .where({ campaignId })
      .where((m: any) => m.status.eq(MESSAGE_STATUS.PENDING))
      .orderBy([(m: any) => m.createdAt.asc(), (m: any) => m.id.asc()])
      .limit(1)
      .all();
    const first = Array.isArray(rows) ? rows[0] : null;
    return first ?? null;
  }

  private buildTemplateValues(msg: any, customer: any): Record<string, string> {
    const values: Record<string, string> = {
      customer_name: msg.customerName,
      mobile_no: msg.mobile,
      mobile: msg.mobile,
    };

    // Merge imported custom variables. customer.variables holds the remaining
    // columns imported from the CSV/XLSX row as JSON.
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
    return values;
  }

  /**
   * Reduce a gateway error to a short, storable string. Only the status, the
   * Meta error code and its message are kept — never the raw response body,
   * which can echo back the template payload.
   */
  private describeSendError(error: unknown): string {
    if (error === null || error === undefined) return 'unknown error';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      const e = error as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof e.httpStatus === 'number') parts.push(`http=${e.httpStatus}`);
      if (typeof e.code === 'number') parts.push(`code=${e.code}`);
      if (typeof e.message === 'string' && e.message) parts.push(e.message);
      const summary = parts.join(' ');
      if (summary) return summary;
    }
    return 'unknown error';
  }

  private async complete(campaignId: string, state: EngineState) {
    // A pause or stop that landed while the last send was in flight wins.
    if (this.haltReason(state)) return;
    const campaign = await this.findCampaign(campaignId);
    if (!campaign || campaign.status !== STATUS.RUNNING) return;

    const counters = await this.computeCounters(campaignId);
    await this.updateCampaign(campaignId, { ...counters, status: STATUS.COMPLETED });
    this.logger.log(
      `Campaign ${campaignId} completed sent=${counters.sent} failed=${counters.failed} pending=${counters.pending}`,
    );
  }

  private async failCampaign(campaignId: string) {
    const campaign = await this.findCampaign(campaignId);
    if (!campaign) return;
    if (!TRANSITIONS[campaign.status]?.includes(STATUS.FAILED)) return;

    const counters = await this.computeCounters(campaignId);
    await this.updateCampaign(campaignId, { ...counters, status: STATUS.FAILED });
  }

  /**
   * The campaign runner. One message at a time, always the oldest PENDING row
   * of this campaign, throttled between real send attempts only.
   */
  private async runLoop(campaignId: string, state: EngineState) {
    try {
      const campaign = await this.getCampaignOrThrow(campaignId);
      const tpl = await this.templates.getById(campaign.templateId);
      const run: CampaignRun = {
        campaignId,
        throttleMs: campaign.throttleMs || DEFAULT_THROTTLE_MS,
        template: {
          body: tpl.body,
          metaName: tpl.metaName ?? null,
          metaLanguage: tpl.metaLanguage ?? null,
        },
      };

      while (true) {
        const halt = this.haltReason(state);
        if (halt) {
          this.logger.log(`Campaign ${campaignId} ${halt}`);
          break;
        }

        const msg = await this.nextPendingMessage(campaignId);
        if (!msg) {
          await this.complete(campaignId, state);
          break;
        }

        // Hard retry ceiling. A PENDING row that already spent its budget is
        // retired without contacting WhatsApp; this is what makes it impossible
        // for the loop to spin on the same message forever.
        if ((msg.attemptCount ?? 0) >= MAX_ATTEMPTS) {
          this.logger.warn(
            `Campaign ${campaignId}: message ${msg.id} exhausted ${MAX_ATTEMPTS} attempts, marking FAILED`,
          );
          await this.updateMessage(msg.id, {
            status: MESSAGE_STATUS.FAILED,
            error: msg.error ?? `Exhausted ${MAX_ATTEMPTS} delivery attempts`,
          });
          await this.syncCounters(campaignId);
          continue;
        }

        const { attempted } = await this.deliver(msg, run, state);
        await this.syncCounters(campaignId);

        // A message that was blocked before delivery (missing customer,
        // unresolved variable) owes no throttle: nothing was sent to Meta.
        if (!attempted) continue;
        if (this.haltReason(state)) break;

        // Look ahead before sleeping. The throttle separates two send
        // attempts, so an exhausted queue must not be delayed by a wait it
        // would never use — otherwise every campaign reports COMPLETED one
        // full throttle period late.
        const more = await this.nextPendingMessage(campaignId);
        if (!more) {
          await this.complete(campaignId, state);
          break;
        }

        await this.sleepInterruptible(run.throttleMs, state);
      }
    } catch (e) {
      // An engine-level fault (unreadable template, database error) is not a
      // delivery failure: FAILED says the campaign never finished, where
      // COMPLETED would falsely imply every message reached a terminal state.
      this.logger.error(`Campaign ${campaignId} loop crashed: ${(e as Error).message}`);
      await this.failCampaign(campaignId).catch(() => undefined);
    } finally {
      // Release the claim only while we are still the registered state, so a
      // pause/resume pair that already installed a new runner is untouched.
      if (this.engines.get(campaignId) === state) {
        state.running = false;
      }
    }
  }

  /**
   * Attempt one message. Returns whether a real WhatsApp send was made, so the
   * caller only throttles between actual send attempts.
   */
  private async deliver(
    msg: any,
    run: CampaignRun,
    state: EngineState,
  ): Promise<{ attempted: boolean }> {
    if (this.haltReason(state)) return { attempted: false };

    // One customer lookup by primary key instead of scanning every customer.
    const customer = this.customerApi?.where
      ? await this.customerApi.where({ id: msg.customerId }).first()
      : null;

    if (!customer) {
      // Deterministic fault: no send is attempted, so the attempt budget of
      // this message is left exactly as it was.
      await this.updateMessage(msg.id, {
        status: MESSAGE_STATUS.FAILED,
        error: 'Customer record not found',
      });
      return { attempted: false };
    }

    const { body, metaName, metaLanguage } = run.template;
    const values = this.buildTemplateValues(msg, customer);
    const { rendered, missing } = TemplatesService.render(body, values);

    // Never send an unresolved template variable.
    if (missing.length > 0) {
      await this.updateMessage(msg.id, {
        content: rendered,
        status: MESSAGE_STATUS.FAILED,
        error: `Missing template variables: ${missing.join(', ')}`,
      });
      this.logger.warn(
        `Campaign ${run.campaignId}: message ${msg.id} blocked, missing variables: ${missing.join(', ')}`,
      );
      return { attempted: false };
    }

    // Store the final personalized content before attempting delivery.
    await this.updateMessage(msg.id, { content: rendered });

    const result = metaName
      ? await this.wa.sendTemplate(msg.mobile, {
          name: metaName,
          language: metaLanguage || 'en',
          parameters: TemplatesService.extractTemplateParameters(body, values),
        })
      : await this.wa.sendText(msg.mobile, rendered);

    // attemptCount tracks actual send attempts and only ever moves forward.
    const attemptCount = (msg.attemptCount ?? 0) + 1;

    if (result.ok) {
      await this.updateMessage(msg.id, {
        content: rendered,
        status: MESSAGE_STATUS.SENT,
        whatsappId: result.whatsappId ?? null,
        error: null,
        attemptCount,
        sentAt: this.now(),
      });
      return { attempted: true };
    }

    // Keep the latest meaningful error and only stay retryable while there is
    // budget left; otherwise the message settles as FAILED for good.
    const exhausted = attemptCount >= MAX_ATTEMPTS;
    await this.updateMessage(msg.id, {
      content: rendered,
      status: exhausted ? MESSAGE_STATUS.FAILED : MESSAGE_STATUS.PENDING,
      error: this.describeSendError(result.error),
      attemptCount,
    });
    return { attempted: true };
  }

  /**
   * Wait out the campaign throttle, but wake immediately when the campaign is
   * paused or stopped so control actions are never held up by the delay.
   */
  private sleepInterruptible(ms: number, state: EngineState): Promise<void> {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.wake = null;
        resolve();
      }, ms);
      // A pending throttle must never hold the process open.
      (timer as unknown as { unref?: () => void }).unref?.();
      state.wake = () => {
        clearTimeout(timer);
        state.wake = null;
        resolve();
      };
    });
  }
}
