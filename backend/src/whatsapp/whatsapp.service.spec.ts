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

  it('sendText returns a dry-run id and never contacts Meta when mode is dry', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'dry' });
    const res = await wa.sendText('9876543210', 'Hello');
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('dry');
    expect(res.whatsappId).toMatch(/^dry-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendText falls back to dry-run when credentials are missing', async () => {
    const wa = makeService({ WHATSAPP_MODE: 'live' });
    const res = await wa.sendText('9876543210', 'Hello');
    expect(res.mode).toBe('dry');
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});