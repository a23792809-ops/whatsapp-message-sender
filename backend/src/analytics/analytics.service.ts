import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DashboardStats {
  customers: {
    total: number;
    pending: number;
    sent: number;
    failed: number;
  };
  campaigns: {
    total: number;
    running: number;
    completed: number;
  };
  messages: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
  };
  /**
   * Delivery breakdown, additive to the dashboard's existing shape.
   *
   * Kept separate from `messages` so the established buckets (and any consumer
   * that asserts on their exact shape) are untouched. `messages.sent` already
   * counts DELIVERED and READ as accepted, so these numbers are the "how far did
   * it actually get" view rather than a second, competing definition of sent.
   */
  deliveries: {
    total: number;
    pending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    /** Share of accepted messages confirmed delivered, 0-100 with one decimal. */
    deliveryRate: number;
    /** Share of accepted messages confirmed read, 0-100 with one decimal. */
    readRate: number;
  };
  /** 0-100, one decimal place. 0 when nothing has been processed. */
  successRate: number;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    total: number;
    sent: number;
    failed: number;
    pending: number;
    createdAt: unknown;
  }>;
}

const RECENT_CAMPAIGN_LIMIT = 5;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get customerApi(): any {
    return (this.prisma.client as any).orm?.public?.Customer;
  }
  private get campaignApi(): any {
    return (this.prisma.client as any).orm?.public?.Campaign;
  }
  private get messageApi(): any {
    return (this.prisma.client as any).orm?.public?.Message;
  }

  async dashboard(): Promise<DashboardStats> {
    const [customerRows, campaignRows, messageRows, campaignTotal, recentCampaigns] = await Promise.all([
      this.customerApi.groupBy('status').aggregate((a: any) => ({ n: a.count() })),
      this.campaignApi.groupBy('status').aggregate((a: any) => ({ n: a.count() })),
      this.messageApi.groupBy('status').aggregate((a: any) => ({ n: a.count() })),
      this.campaignApi.aggregate((a: any) => ({ n: a.count() })),
      this.campaignApi
        .orderBy([(c: any) => c.createdAt.desc(), (c: any) => c.id.desc()])
        .limit(RECENT_CAMPAIGN_LIMIT)
        .all(),
    ]);

    const customers = tally(customerRows, {
      sent: ['SENT', 'COMPLETED'],
      failed: ['FAILED'],
      pending: ['PENDING', 'DRAFT'],
    }) as { sent: number; failed: number; pending: number };
    const campaigns = tally(campaignRows, {
      running: ['RUNNING', 'PAUSED', 'QUEUED'],
      completed: ['COMPLETED'],
    }) as { running: number; completed: number };
    const messages = tally(messageRows, {
      // DELIVERED and READ are later stages of a send we already counted as
      // successful. Excluding them here would silently drop them from `total`
      // and make the dashboard shrink as webhooks arrive.
      sent: ['SENT', 'DELIVERED', 'READ'],
      failed: ['FAILED'],
      pending: ['PENDING'],
    }) as { sent: number; failed: number; pending: number };

    // The same grouped rows we already fetched, read a second way. No extra
    // query, no second pass over the table.
    const delivery = tally(messageRows, {
      pending: ['PENDING'],
      sent: ['SENT'],
      delivered: ['DELIVERED'],
      read: ['READ'],
      failed: ['FAILED'],
    }) as { pending: number; sent: number; delivered: number; read: number; failed: number };
    const accepted = delivery.sent + delivery.delivered + delivery.read;

    // The denominator is messages that actually reached an outcome. A
    // campaign full of unsent messages has no success rate yet, and reporting
    // 100% (or 0/0) for that case would be actively misleading.
    const processed = messages.sent + messages.failed;
    const successRate = processed === 0 ? 0 : Math.round((messages.sent / processed) * 1000) / 10;

    const recent = await unwrap<any[]>(recentCampaigns);

    return {
      customers: {
        total: customers.sent + customers.failed + customers.pending,
        pending: customers.pending,
        sent: customers.sent,
        failed: customers.failed,
      },
      campaigns: { total: Number(campaignTotal?.n ?? 0), running: campaigns.running, completed: campaigns.completed },
      messages: {
        total: messages.sent + messages.failed + messages.pending,
        sent: messages.sent,
        failed: messages.failed,
        pending: messages.pending,
      },
      deliveries: {
        total: delivery.pending + accepted + delivery.failed,
        pending: delivery.pending,
        sent: delivery.sent,
        delivered: delivery.delivered,
        read: delivery.read,
        failed: delivery.failed,
        // Denominator is "accepted by WhatsApp", not "all messages": pending
        // rows have no delivery outcome yet, so including them would drag both
        // rates down for messages that simply have not been sent.
        deliveryRate: accepted === 0 ? 0 : Math.round(((delivery.delivered + delivery.read) / accepted) * 1000) / 10,
        readRate: accepted === 0 ? 0 : Math.round((delivery.read / accepted) * 1000) / 10,
      },
      successRate,
      recentCampaigns: (recent ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        total: c.total,
        sent: c.sent,
        failed: c.failed,
        pending: c.pending,
        createdAt: c.createdAt,
      })),
    };
  }
}

/**
 * Sums a grouped count result into named buckets. Statuses outside a bucket
 * are intentionally ignored: they are neither sent nor failed, and folding
 * them into "pending" would misreport the numbers.
 */
function tally(rows: any, buckets: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(buckets)) out[key] = 0;
  for (const row of rows ?? []) {
    for (const [key, statuses] of Object.entries(buckets)) {
      if (statuses.includes(row.status)) out[key] += Number(row.n ?? 0);
    }
  }
  return out;
}

/** Query results are sometimes an array and sometimes a thenable. */
async function unwrap<T>(value: any): Promise<T> {
  return (Array.isArray(value) ? value : await value) as T;
}
