/**
 * Audit vocabulary.
 *
 * `actor` is intentionally NOT a user identity. Authentication in this
 * application is a single shared admin session, so attributing an action to a
 * person would be a fiction. We record the honest value instead: the component
 * that performed the work.
 */
export const AuditActor = {
  /** A background worker or the campaign engine. */
  SYSTEM: 'SYSTEM',
  /** Triggered by an inbound HTTP request. */
  REQUEST: 'REQUEST',
} as const;

export const AuditEntityType = {
  CUSTOMER: 'customer',
  TEMPLATE: 'template',
  CAMPAIGN: 'campaign',
  MESSAGE: 'message',
  WHATSAPP: 'whatsapp',
  SETTINGS: 'settings',
  SYSTEM: 'system',
} as const;

export const AuditAction = {
  CUSTOMER_IMPORT: 'CUSTOMER_IMPORT',
  CUSTOMER_IMPORT_PREVIEW: 'CUSTOMER_IMPORT_PREVIEW',
  TEMPLATE_CREATE: 'TEMPLATE_CREATE',
  TEMPLATE_UPDATE: 'TEMPLATE_UPDATE',
  TEMPLATE_ARCHIVE: 'TEMPLATE_ARCHIVE',
  CAMPAIGN_CREATE: 'CAMPAIGN_CREATE',
  CAMPAIGN_START: 'CAMPAIGN_START',
  CAMPAIGN_PAUSE: 'CAMPAIGN_PAUSE',
  CAMPAIGN_RESUME: 'CAMPAIGN_RESUME',
  CAMPAIGN_STOP: 'CAMPAIGN_STOP',
  CAMPAIGN_RETRY: 'CAMPAIGN_RETRY',
  MESSAGE_SEND: 'MESSAGE_SEND',
  WHATSAPP_TEST_SEND: 'WHATSAPP_TEST_SEND',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  /** A webhook POST was accepted and processed. Never stores the payload. */
  WHATSAPP_WEBHOOK_RECEIVED: 'WHATSAPP_WEBHOOK_RECEIVED',
  /** A delivery event moved a message forward. */
  WHATSAPP_STATUS_UPDATED: 'WHATSAPP_STATUS_UPDATED',
  /** A valid but inapplicable event (replay, downgrade, unknown status). */
  WHATSAPP_STATUS_IGNORED: 'WHATSAPP_STATUS_IGNORED',
  /** A delivery event referenced a whatsappId we have no message for. */
  WHATSAPP_STATUS_UNKNOWN_MESSAGE: 'WHATSAPP_STATUS_UNKNOWN_MESSAGE',
  /** Verification or signature verification failed. */
  WHATSAPP_WEBHOOK_REJECTED: 'WHATSAPP_WEBHOOK_REJECTED',
} as const;

export const AuditStatus = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
export type AuditEntityTypeValue = (typeof AuditEntityType)[keyof typeof AuditEntityType];
export type AuditStatusValue = (typeof AuditStatus)[keyof typeof AuditStatus];
export type AuditActorValue = (typeof AuditActor)[keyof typeof AuditActor];

export interface AuditRecordInput {
  action: string;
  entityType?: string;
  entityId?: string | null;
  status?: string;
  actor?: string;
  /** Short, already-safe summary. Never a payload, token or message body. */
  message?: string | null;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
  search?: string;
}
