import type { MessageSummary } from './api';

export interface CampaignProgress {
  processed: number;
  percent: number;
}

/**
 * Calculates campaign progress safely, handling zero totals and clamping between 0 and 100.
 */
export function calculateCampaignProgress(
  total: number,
  sent = 0,
  failed = 0,
): CampaignProgress {
  const processed = Math.max(0, sent + failed);
  if (!total || total <= 0) {
    return { processed: 0, percent: 0 };
  }
  const percent = Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
  return { processed, percent };
}

export type CampaignAction = 'start' | 'pause' | 'resume' | 'stop' | 'retry';

/**
 * Determines which operational actions are allowed given a campaign's status and failure count.
 */
export function getAvailableCampaignActions(
  status: string,
  failedCount = 0,
): CampaignAction[] {
  const upper = (status || '').toUpperCase();
  const actions: CampaignAction[] = [];

  if (upper === 'DRAFT' || upper === 'QUEUED') {
    actions.push('start');
  } else if (upper === 'RUNNING') {
    actions.push('pause', 'stop');
  } else if (upper === 'PAUSED') {
    actions.push('resume', 'stop');
  }

  if (failedCount > 0 && upper !== 'RUNNING') {
    actions.push('retry');
  }

  return actions;
}

/**
 * Validates whether a specific action is permitted on a campaign.
 */
export function canPerformCampaignAction(
  status: string,
  action: CampaignAction,
  failedCount = 0,
): boolean {
  return getAvailableCampaignActions(status, failedCount).includes(action);
}

/**
 * Client-side message history filtering by search query and delivery status.
 */
export function filterMessages(
  messages: MessageSummary[],
  searchQuery = '',
  statusFilter = 'ALL',
): MessageSummary[] {
  const query = searchQuery.trim().toLowerCase();
  const upperFilter = statusFilter.toUpperCase();

  return messages.filter((msg) => {
    const matchSearch =
      query === '' ||
      (msg.customerName && msg.customerName.toLowerCase().includes(query)) ||
      (msg.mobile && msg.mobile.includes(query)) ||
      (msg.whatsappId && msg.whatsappId.toLowerCase().includes(query)) ||
      (msg.content && msg.content.toLowerCase().includes(query));

    const upperStatus = (msg.status || 'PENDING').toUpperCase();
    const matchStatus =
      upperFilter === 'ALL' ||
      upperStatus === upperFilter;

    return matchSearch && matchStatus;
  });
}
