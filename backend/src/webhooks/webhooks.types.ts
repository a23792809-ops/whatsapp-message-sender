/**
 * WhatsApp Cloud API webhook vocabulary and delivery-state policy.
 *
 * Everything about "what may a delivery status become" lives here, in one
 * place, so the controller and service never grow ad-hoc string comparisons.
 */

/* ------------------------------------------------------------------ */
/* Delivery status vocabulary                                          */
/* ------------------------------------------------------------------ */

/**
 * The delivery lifecycle of a single message.
 *
 * PENDING / SENT already existed and are owned by the campaign engine; this
 * module only ever moves a message *forward* out of SENT. See
 * `resolveTransition` for the exact rules.
 */
export const DeliveryStatus = {
  /** Queued locally; the send API has not accepted it yet. */
  PENDING: 'PENDING',
  /** Meta accepted the message for delivery. */
  SENT: 'SENT',
  /** Meta confirmed delivery to the recipient's device. */
  DELIVERED: 'DELIVERED',
  /** The recipient (or a business API client) read the message. */
  READ: 'READ',
  /** Delivery failed. Terminal for this delivery attempt. */
  FAILED: 'FAILED',
} as const;

export type DeliveryStatusValue = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/** Statuses that mean "Meta accepted the message", regardless of how far it got. */
export const ACCEPTED_STATUSES: readonly string[] = [
  DeliveryStatus.SENT,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.READ,
];

/**
 * Monotonic progress rank. A state may only be replaced by a *strictly higher*
 * rank, which is what makes an out-of-order webhook harmless.
 *
 * FAILED is deliberately absent: it is terminal rather than "further along".
 */
const RANK: Record<string, number> = {
  [DeliveryStatus.PENDING]: 0,
  [DeliveryStatus.SENT]: 1,
  [DeliveryStatus.DELIVERED]: 2,
  [DeliveryStatus.READ]: 3,
};

/** Meta status values we accept from a delivery event. */
export const WEBHOOK_STATUS_MAP: Readonly<Record<string, DeliveryStatusValue>> = {
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  read: DeliveryStatus.READ,
  failed: DeliveryStatus.FAILED,
  deleted: DeliveryStatus.FAILED,
};

/* ------------------------------------------------------------------ */
/* Transition policy                                                   */
/* ------------------------------------------------------------------ */

export type TransitionDecision =
  /** Move the message to `next`, writing the lifecycle timestamps. */
  | { action: 'apply'; next: DeliveryStatusValue; reason: string }
  /** Valid event, but it must not change the stored state. */
  | { action: 'skip'; reason: string }
  /** Not a delivery status we model (e.g. an unknown future value). */
  | { action: 'unsupported'; reason: string };

/**
 * The single authority on delivery-state transitions.
 *
 * Rules, in order:
 *
 *  1. An unrecognised status is `unsupported` — we never guess, so a new Meta
 *     status can never corrupt a message.
 *  2. FAILED is terminal. Once a message is FAILED nothing moves it again:
 *     a late `delivered` that Meta emits after a failure must not resurrect it.
 *  3. Otherwise the progression is strictly monotonic. A status may only
 *     replace a lower-ranked one, so `read` → `delivered` and
 *     `delivered` → `sent` are refused, as is any repeat (`read` → `read`).
 *     Repeats are `skip`, not errors, because Meta retries deliveries freely.
 *  4. `PENDING` is never produced by a webhook; it belongs to the send path.
 */
export function resolveTransition(current: unknown, incoming: unknown): TransitionDecision {
  const from = typeof current === 'string' ? current.trim().toUpperCase() : '';
  const to = typeof incoming === 'string' ? incoming.trim().toUpperCase() : '';

  if (!(to in RANK) && to !== DeliveryStatus.FAILED) {
    return { action: 'unsupported', reason: `status "${to || '(empty)'}" is not a modelled delivery state` };
  }
  if (to === DeliveryStatus.PENDING) {
    return { action: 'unsupported', reason: 'a webhook never moves a message back to PENDING' };
  }

  if (from === DeliveryStatus.FAILED) {
    return { action: 'skip', reason: 'message is already FAILED, which is terminal' };
  }

  const fromRank = from in RANK ? RANK[from] : undefined;
  const toRank = to === DeliveryStatus.FAILED ? Number.POSITIVE_INFINITY : RANK[to];

  if (fromRank === undefined) {
    // An unrecognised stored state (e.g. legacy data) accepts any known
    // status rather than stranding the message.
    return { action: 'apply', next: to as DeliveryStatusValue, reason: `adopting unknown state "${from}"` };
  }
  if (toRank > fromRank) {
    return { action: 'apply', next: to as DeliveryStatusValue, reason: `${from} -> ${to}` };
  }
  if (toRank === fromRank) {
    return { action: 'skip', reason: `${from} already recorded` };
  }
  return {
    action: 'skip',
    reason: `refusing to downgrade ${from} -> ${to} (out-of-order or replayed delivery event)`,
  };
}

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

/** How far ahead of our own clock a provider timestamp may be before we distrust it. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

/** Messages older than this (or before 2015) are treated as nonsense. */
const MIN_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);

/**
 * Converts a Meta `status.timestamp` (Unix epoch **seconds**, sent as a string)
 * into the value we persist.
 *
 * Semantics, chosen deliberately:
 *
 *  - We store Meta's own event time when it is plausible, because it is the
 *    ground truth for "when did the recipient's device get this". Our receipt
 *    time is only a fallback.
 *  - Anything implausible (absent, non-numeric, zero, before 2015, or more
 *    than 5 minutes in the future — the usual symptom of a clock skew) is
 *    discarded in favour of local receipt time. An arbitrary invalid date must
 *    never reach the database.
 */
export function resolveEventTimestamp(raw: unknown, receivedAt: Date = new Date()): Date {
  const fallback = new Date(receivedAt.getTime());
  if (raw === null || raw === undefined) return fallback;

  // Only a number or a numeric string is meaningful here. Stringifying anything
  // else would happily produce "[object Object]" and then Number() it to NaN,
  // so the type is narrowed explicitly rather than coerced.
  let numeric: number;
  if (typeof raw === 'number') {
    numeric = raw;
  } else if (typeof raw === 'string') {
    numeric = Number(raw.trim());
  } else {
    return fallback;
  }
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;

  // Meta sends seconds. Tolerate a millisecond value that some gateways pass.
  const ms = numeric > 1e11 ? numeric : numeric * 1000;
  if (!Number.isFinite(ms) || ms < MIN_PLAUSIBLE_MS) return fallback;
  if (ms > receivedAt.getTime() + MAX_FUTURE_SKEW_MS) return fallback;

  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/* ------------------------------------------------------------------ */
/* Failure details                                                     */
/* ------------------------------------------------------------------ */

/** Bounded so a verbose Meta detail string can never bloat a message row. */
export const MAX_ERROR_LENGTH = 300;

export type SafeFailure = {
  /** Bounded, human-readable, free of tokens and raw payloads. */
  text: string;
  /** Meta's numeric code, when present. */
  code: number | null;
};

type RawError = {
  code?: unknown;
  title?: unknown;
  message?: unknown;
  error_data?: { details?: unknown };
  details?: unknown;
};

/**
 * Strips the useful part out of a Meta `statuses[].errors[]` entry.
 *
 * We keep code, title and message. We deliberately never keep the raw error
 * object, `error_data` or any header, because Meta error bodies can echo parts
 * of the original request. The result is redacted again by `AuditService` and
 * length-bounded here.
 */
export function describeFailure(errors: unknown): SafeFailure | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;

  const first = errors.find((e): e is RawError => !!e && typeof e === 'object') as RawError | undefined;
  if (!first) return null;

  const code = typeof first.code === 'number' && Number.isFinite(first.code) ? Math.trunc(first.code) : null;

  const clean = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    // Defence in depth: a provider string should never be able to smuggle a
    // bearer token or JWT into a stored error.
    return value
      .replace(/\b(bearer)\s+[A-Za-z0-9._-]+/gi, '$1 [redacted]')
      .replace(/\b(eyJ[A-Za-z0-9._-]{10,})\b/g, '[redacted]')
      .replace(/\b(EA[A-Za-z0-9]{20,})\b/g, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const title = clean(first.title);
  const message = clean(first.message) || clean(first.error_data?.details) || clean(first.details);
  const parts = [title, message].filter(Boolean);
  // Prefer the more specific text, but keep the code visible for support.
  const text = [code !== null ? `code ${code}` : '', parts[0] ?? '', ...(parts.length > 1 ? [parts[1]] : [])]
    .filter(Boolean)
    .join(': ');

  const bounded = text.slice(0, MAX_ERROR_LENGTH);
  return { text: bounded.length ? bounded : 'delivery failed (no details supplied)', code };
}
