/**
 * Request-URL redaction for logging.
 *
 * Lives in its own module rather than in `main.ts` because `main.ts` starts the
 * server as a side effect of being imported, which would make a unit test
 * impossible.
 */

/**
 * Query parameters whose values must never reach a log line.
 *
 * `hub.verify_token` is the important one: Meta's subscription handshake puts
 * the webhook verification token directly in the query string, so logging the
 * raw URL writes that credential to stdout — and from there to log aggregation,
 * error tracking and CI output. The rest are defence in depth for anything that
 * might later gain a token-bearing query parameter.
 */
const SENSITIVE_QUERY_PARAMS = [
  'hub.verify_token',
  'verify_token',
  'access_token',
  'token',
  'secret',
  'password',
  'api_key',
  'apikey',
  'authorization',
];

/**
 * Renders a request URL with credential-bearing query values replaced.
 *
 * A URL that carries no sensitive parameter is returned unchanged, so ordinary
 * request logging keeps full fidelity (search terms, filters, pagination all
 * still appear). Only a URL that actually contains a credential is rewritten.
 */
export function redactUrlForLog(url: string | undefined): string {
  if (!url) return '';
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let redacted = false;
  for (const key of SENSITIVE_QUERY_PARAMS) {
    if (params.has(key)) {
      params.set(key, '[redacted]');
      redacted = true;
    }
  }
  return redacted ? `${path}?${params.toString()}` : url;
}
