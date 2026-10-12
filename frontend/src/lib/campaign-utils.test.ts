import { describe, it, expect } from 'vitest';
import {
  calculateCampaignProgress,
  getAvailableCampaignActions,
  canPerformCampaignAction,
  filterMessages,
} from './campaign-utils';
import type { MessageSummary } from './api';

describe('campaign-utils', () => {
  describe('calculateCampaignProgress', () => {
    it('returns 0% when total is 0 or negative', () => {
      expect(calculateCampaignProgress(0, 0, 0)).toEqual({ processed: 0, percent: 0 });
      expect(calculateCampaignProgress(-5, 0, 0)).toEqual({ processed: 0, percent: 0 });
    });

    it('computes correct percentage from sent and failed counts', () => {
      // 50 sent + 0 failed out of 100
      expect(calculateCampaignProgress(100, 50, 0)).toEqual({ processed: 50, percent: 50 });
      // 70 sent + 10 failed out of 100 = 80%
      expect(calculateCampaignProgress(100, 70, 10)).toEqual({ processed: 80, percent: 80 });
      // 1 out of 3 = 33%
      expect(calculateCampaignProgress(3, 1, 0)).toEqual({ processed: 1, percent: 33 });
    });

    it('clamps percentage to 100% when processed exceeds total', () => {
      expect(calculateCampaignProgress(50, 50, 5)).toEqual({ processed: 55, percent: 100 });
    });
  });

  describe('getAvailableCampaignActions and canPerformCampaignAction', () => {
    it('allows starting a DRAFT or QUEUED campaign', () => {
      expect(getAvailableCampaignActions('DRAFT')).toEqual(['start']);
      expect(getAvailableCampaignActions('QUEUED')).toEqual(['start']);
      expect(canPerformCampaignAction('DRAFT', 'start')).toBe(true);
      expect(canPerformCampaignAction('DRAFT', 'pause')).toBe(false);
    });

    it('allows pausing and stopping a RUNNING campaign', () => {
      expect(getAvailableCampaignActions('RUNNING')).toEqual(['pause', 'stop']);
      expect(canPerformCampaignAction('RUNNING', 'pause')).toBe(true);
      expect(canPerformCampaignAction('RUNNING', 'stop')).toBe(true);
      expect(canPerformCampaignAction('RUNNING', 'start')).toBe(false);
    });

    it('allows resuming and stopping a PAUSED campaign', () => {
      expect(getAvailableCampaignActions('PAUSED')).toEqual(['resume', 'stop']);
      expect(canPerformCampaignAction('PAUSED', 'resume')).toBe(true);
      expect(canPerformCampaignAction('PAUSED', 'stop')).toBe(true);
      expect(canPerformCampaignAction('PAUSED', 'start')).toBe(false);
    });

    it('allows retry when there are failed messages and campaign is not running', () => {
      expect(getAvailableCampaignActions('PAUSED', 3)).toEqual(['resume', 'stop', 'retry']);
      expect(getAvailableCampaignActions('COMPLETED', 5)).toEqual(['retry']);
      expect(canPerformCampaignAction('COMPLETED', 'retry', 5)).toBe(true);
      expect(canPerformCampaignAction('COMPLETED', 'retry', 0)).toBe(false);
    });

    it('does not allow retry while campaign is still actively RUNNING', () => {
      expect(getAvailableCampaignActions('RUNNING', 2)).toEqual(['pause', 'stop']);
      expect(canPerformCampaignAction('RUNNING', 'retry', 2)).toBe(false);
    });
  });

  describe('filterMessages', () => {
    const messages: MessageSummary[] = [
      {
        id: 'm1',
        customerId: 'c1',
        campaignId: 'camp1',
        mobile: '9820011111',
        customerName: 'Kavita Roy',
        content: 'Your LPG refill is confirmed.',
        status: 'SENT',
        whatsappId: 'wamid.HBgM1',
        error: null,
        errorCode: null,
        attemptCount: 1,
        sentAt: '2026-10-12T10:00:00Z',
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        createdAt: '2026-10-12T10:00:00Z',
      },
      {
        id: 'm2',
        customerId: 'c2',
        campaignId: 'camp1',
        mobile: '9820022222',
        customerName: 'Mohan Lal',
        content: 'Agency address updated to Alibag.',
        status: 'DELIVERED',
        whatsappId: 'wamid.HBgM2',
        error: null,
        errorCode: null,
        attemptCount: 1,
        sentAt: '2026-10-12T10:01:00Z',
        deliveredAt: '2026-10-12T10:01:10Z',
        readAt: null,
        failedAt: null,
        createdAt: '2026-10-12T10:01:00Z',
      },
      {
        id: 'm3',
        customerId: 'c3',
        campaignId: 'camp1',
        mobile: '9820033333',
        customerName: 'Sneha Kulkarni',
        content: 'Safety inspection reminder.',
        status: 'READ',
        whatsappId: 'wamid.HBgM3',
        error: null,
        errorCode: null,
        attemptCount: 1,
        sentAt: '2026-10-12T10:02:00Z',
        deliveredAt: '2026-10-12T10:02:05Z',
        readAt: '2026-10-12T10:02:20Z',
        failedAt: null,
        createdAt: '2026-10-12T10:02:00Z',
      },
      {
        id: 'm4',
        customerId: 'c4',
        campaignId: null,
        mobile: '9820044444',
        customerName: 'Anil Jadhav',
        content: 'Single direct send attempt.',
        status: 'FAILED',
        whatsappId: null,
        error: 'Recipient not registered',
        errorCode: 131030,
        attemptCount: 3,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: '2026-10-12T10:03:00Z',
        createdAt: '2026-10-12T10:03:00Z',
      },
    ];

    it('filters messages by search text in customer name or mobile or content', () => {
      expect(filterMessages(messages, 'Kavita')).toHaveLength(1);
      expect(filterMessages(messages, '22222')).toHaveLength(1);
      expect(filterMessages(messages, 'Alibag')).toHaveLength(1);
      expect(filterMessages(messages, 'wamid.HBgM3')).toHaveLength(1);
    });

    it('filters messages by status', () => {
      expect(filterMessages(messages, '', 'SENT')).toHaveLength(1);
      expect(filterMessages(messages, '', 'DELIVERED')).toHaveLength(1);
      expect(filterMessages(messages, '', 'READ')).toHaveLength(1);
      expect(filterMessages(messages, '', 'FAILED')).toHaveLength(1);
    });

    it('returns all messages when filter is ALL and search is empty', () => {
      expect(filterMessages(messages, '', 'ALL')).toHaveLength(4);
    });
  });
});
