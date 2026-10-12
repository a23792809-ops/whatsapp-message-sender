import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { normalizeE164, WhatsAppService } from './whatsapp.service.js';

function makeService(env: Record<string, string> = {}) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new WhatsAppService(config);
}

describe('normalizeE164', () => {
  it('prefixes the default country code for plain 10-digit numbers', () => {
    expect(normalizeE164('9876543210')).toBe('919876543210');
  });

  it('keeps already-international numbers as digits', () => {
    expect(normalizeE164('+91 98765 43210')).toBe('919876543210');
    expect(normalizeE164('919876543210')).toBe('919876543210');
  });

  it('drops leading 0 and 00 prefixes', () => {
    expect(normalizeE164('0 98765 43210')).toBe('919876543210');
    expect(normalizeE164('00 91 9876543210')).toBe('919876543210');
  });

  it('respects a custom country code', () => {
    expect(normalizeE164('9876543210', '971')).toBe('9719876543210');
  });

  it('rejects empty or invalid lengths', () => {
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164('123')).toBeNull();
    expect(normalizeE164('1234567890123456')).toBeNull();
  });
});

describe('WhatsAppService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sendText still returns a dry-run id and never contacts Meta when mode is dry', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'dry' });
    const res = await wa.sendText('9876543210', 'Hello');
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('dry');
    expect(res.whatsappId).toMatch(/^dry-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- live mode fails closed -------------------------------------------
  //
  // Live mode with missing Meta credentials used to fall back to the dry-run
  // simulator, which returned a fabricated `dry-…` id. A campaign reading that
  // result could not tell "delivered" from "never sent", so live mode now
  // rejects the send instead.

  it('sendText fails closed when BOTH credentials are missing, without contacting Meta', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live' });
    const res = await wa.sendText('9876543210', 'Hello');

    expect(res.ok).toBe(false);
    expect(res.mode).toBe('text');
    expect(res.error?.httpStatus).toBe(503);
    expect(res.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');
    expect(res.error?.message).toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(res.error?.message).toContain('WHATSAPP_ACCESS_TOKEN');
    // No simulated id: a fabricated success is exactly what we are preventing.
    expect(res.whatsappId).toBeUndefined();
    // No outbound request was attempted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendText fails closed when only the phone number id is missing', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live', WHATSAPP_ACCESS_TOKEN: 'token-abc' });
    const res = await wa.sendText('9876543210', 'Hello');

    expect(res.ok).toBe(false);
    expect(res.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');
    expect(res.error?.message).toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(res.error?.message).not.toContain('WHATSAPP_ACCESS_TOKEN');
    expect(res.whatsappId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendText fails closed when only the access token is missing', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: '123456' });
    const res = await wa.sendText('9876543210', 'Hello');

    expect(res.ok).toBe(false);
    expect(res.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');
    expect(res.error?.message).toContain('WHATSAPP_ACCESS_TOKEN');
    expect(res.error?.message).not.toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(res.whatsappId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendTemplate fails closed without credentials, without contacting Meta', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live' });
    const res = await wa.sendTemplate('9876543210', { name: 'bharat_gas_delivery' });

    expect(res.ok).toBe(false);
    expect(res.mode).toBe('template');
    expect(res.error?.httpStatus).toBe(503);
    expect(res.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');
    expect(res.whatsappId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendMessage routes through the fail-closed guard for both message types', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live' });

    const text = await wa.sendMessage('9876543210', { type: 'text', body: 'Hello' });
    expect(text.ok).toBe(false);
    expect(text.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');

    const template = await wa.sendMessage('9876543210', { type: 'template', name: 'bharat_gas_delivery' });
    expect(template.ok).toBe(false);
    expect(template.error?.type).toBe('WHATSAPP_NOT_CONFIGURED');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never leaks a credential value in the configuration error', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live', WHATSAPP_ACCESS_TOKEN: 'super-secret-token-value' });
    const res = await wa.sendText('9876543210', 'Hello');

    expect(res.ok).toBe(false);
    expect(res.error?.message).not.toContain('super-secret-token-value');
    expect(JSON.stringify(res)).not.toContain('super-secret-token-value');
  });

  it('reports live-without-credentials honestly in status()', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live' });
    const status = wa.status();

    expect(status.mode).toBe('live');
    // Not simulating any more, and not usable either.
    expect(status.dryRun).toBe(false);
    expect(status.configured).toBe(false);
    // Still never exposes values.
    expect(status.phoneNumberId).toBe('missing');
    expect(status.accessToken).toBe('missing');
  });

  it('isDryRun reflects only the configured mode', () => {
    expect(makeService({ WHATSAPP_MODE: 'dry' }).isDryRun()).toBe(true);
    expect(makeService({}).isDryRun()).toBe(true);
    expect(makeService({ WHATSAPP_MODE: 'live' }).isDryRun()).toBe(false);
    expect(
      makeService({ WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }).isDryRun(),
    ).toBe(false);
  });

  it('live mode with both credentials still reaches the normal sender path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.LIVE123' }] }),
    });
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_ACCESS_TOKEN: 'live-token',
    });

    const text = await wa.sendText('9876543210', 'Hello');
    expect(text.ok).toBe(true);
    expect(text.mode).toBe('text');
    expect(text.whatsappId).toBe('wamid.LIVE123');

    const template = await wa.sendTemplate('9876543210', { name: 'bharat_gas_delivery', parameters: ['A'] });
    expect(template.ok).toBe(true);
    expect(template.mode).toBe('template');
    expect(template.whatsappId).toBe('wamid.LIVE123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/1234567890/messages');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('live-token');
  });

  it('sendText posts a text payload with normalized E.164 recipient and returns the WAMID', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.ABC123' }] }),
    });
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_ACCESS_TOKEN: 'secret-token',
      WHATSAPP_API_VERSION: 'v21.0',
    });

    const res = await wa.sendText('+91 98765 43210', 'Hello Bharat Gas');
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('text');
    expect(res.whatsappId).toBe('wamid.ABC123');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('v21.0/123456/messages');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.to).toBe('919876543210');
    expect(sent.type).toBe('text');
    expect(sent.text).toEqual({ body: 'Hello Bharat Gas', preview_url: false });
  });

  it('sendText parses structured Meta API errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'Recipient phone number not in allowed list',
          type: 'OAuthException',
          code: 131030,
          error_subcode: 1,
          fbtrace_id: 'FBT123',
        },
      }),
    });
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_ACCESS_TOKEN: 'secret-token',
    });

    const res = await wa.sendText('9876543210', 'Hi');
    expect(res.ok).toBe(false);
    expect(res.mode).toBe('text');
    expect(res.error?.code).toBe(131030);
    expect(res.error?.errorSubcode).toBe(1);
    expect(res.error?.message).toContain('allowed list');
    expect(res.error?.fbtraceId).toBe('FBT123');
    expect(res.error?.httpStatus).toBe(400);
  });

  it('sendTemplate builds a body component with positional parameters and returns a WAMID', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.TPL1' }] }),
    });
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });

    const res = await wa.sendTemplate('9876543210', {
      name: 'bharat_gas_delivery',
      language: 'en',
      parameters: ['Ram', 'AB123'],
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('template');
    expect(res.whatsappId).toBe('wamid.TPL1');
    expect(res.meta).toMatchObject({ template: 'bharat_gas_delivery', language: 'en', parameterCount: 2 });

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.type).toBe('template');
    expect(sent.to).toBe('919876543210');
    expect(sent.template).toEqual({
      name: 'bharat_gas_delivery',
      language: 'en',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Ram' }, { type: 'text', text: 'AB123' }] },
      ],
    });
  });

  it('sendTemplate has dry-run parity and never contacts Meta in dry mode', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'dry' });
    const res = await wa.sendTemplate('9876543210', {
      name: 'bharat_gas_delivery',
      language: 'en',
      parameters: ['Ram'],
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('dry');
    expect(res.whatsappId).toMatch(/^dry-/);
    expect(res.meta).toMatchObject({ template: 'bharat_gas_delivery', language: 'en', parameterCount: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendMessage dispatches template vs text by payload type', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    });
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });

    const textRes = await wa.sendMessage('9876543210', { type: 'text', body: 'plain' });
    expect(textRes.mode).toBe('text');

    const tplRes = await wa.sendMessage('9876543210', { type: 'template', name: 'x', language: 'en' });
    expect(tplRes.mode).toBe('template');
  });

  it('rejects an invalid phone number in live mode without calling Meta', async () => {
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });
    const res = await wa.sendText('12', 'hi');
    expect(res.ok).toBe(false);
    expect(res.error?.httpStatus).toBe(400);
    // A malformed number is permanent: retrying the same digits is pointless.
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.kind).toBe('invalid_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- retry classification --------------------------------------------------
  //
  // The campaign engine consults `error.retryable` before spending another
  // attempt. These tests pin the classification on both sides of the line so a
  // future change cannot silently start re-sending messages Meta already
  // refused (or already accepted before a timeout).

  function liveService() {
    return makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });
  }

  it('classifies a 429 as a retryable rate limit and surfaces Retry-After', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (key: string) => (key.toLowerCase() === 'retry-after' ? '2' : null) },
      json: async () => ({ error: { message: 'Rate limit reached', code: 4 } }),
    });

    const res = await liveService().sendText('9876543210', 'Hi');
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('rate_limited');
    expect(res.error?.retryable).toBe(true);
    expect(res.error?.retryAfterMs).toBe(2000);
  });

  it('classifies a 500 as a retryable server error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Meta unavailable', code: 1 } }),
    });

    const res = await liveService().sendText('9876543210', 'Hi');
    expect(res.error?.kind).toBe('server');
    expect(res.error?.retryable).toBe(true);
  });

  it('classifies 401/403 as a non-retryable auth error', async () => {
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }),
      });
      const res = await liveService().sendText('9876543210', 'Hi');
      expect(res.error?.kind).toBe('auth');
      expect(res.error?.retryable).toBe(false);
    }
  });

  it('classifies a 400 rejection as a non-retryable client error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid parameter', code: 100 } }),
    });

    const res = await liveService().sendText('9876543210', 'Hi');
    expect(res.error?.kind).toBe('client');
    expect(res.error?.retryable).toBe(false);
  });

  it('aborts a hung Meta request after the configured timeout and marks it non-retryable', async () => {
    // A fetch that never resolves on its own: only the timeout can end it.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject((init.signal as AbortSignal).reason),
          );
        }),
    );
    const wa = makeService({
      WHATSAPP_MODE: 'live',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_ACCESS_TOKEN: 'tok',
      WHATSAPP_REQUEST_TIMEOUT_MS: '10',
    });

    const res = await wa.sendText('9876543210', 'Hi');
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('timeout');
    // Delivery state is unknown, so a retry could duplicate the message.
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.message).toContain('request aborted');
  });

  it('classifies a dropped connection as a non-retryable network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const res = await liveService().sendText('9876543210', 'Hi');
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('network');
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.message).toBe('fetch failed');
  });

  it('reports the effective request timeout in status() and defaults it sensibly', () => {
    expect(makeService({}).status().requestTimeoutMs).toBe(15_000);
    // Non-numeric and sub-1 values fall back to the default.
    expect(makeService({ WHATSAPP_REQUEST_TIMEOUT_MS: 'abc' }).status().requestTimeoutMs).toBe(15_000);
    expect(makeService({ WHATSAPP_REQUEST_TIMEOUT_MS: '0' }).status().requestTimeoutMs).toBe(15_000);
    // A usable value is honoured; an absurd one is capped.
    expect(makeService({ WHATSAPP_REQUEST_TIMEOUT_MS: '8000' }).status().requestTimeoutMs).toBe(8000);
    expect(makeService({ WHATSAPP_REQUEST_TIMEOUT_MS: '999999999' }).status().requestTimeoutMs).toBe(120_000);
  });
});