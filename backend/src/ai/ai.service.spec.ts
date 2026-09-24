import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { OpenAIProvider } from './providers/openai.provider.js';
import { DeepSeekProvider } from './providers/deepseek.provider.js';

function env(config: Record<string, string>) {
  return { get: (key: string, def?: string) => config[key] ?? def } as unknown as ConfigService;
}

function makeService(config: Record<string, string>) {
  const registry = new ProviderRegistry(env(config));
  return new AiService(registry);
}

function okBody(content: string, model = 'gpt-test-model') {
  return { ok: true, status: 200, json: async () => ({ id: 'chatcmpl-test', model, choices: [{ message: { role: 'assistant', content } }] }) };
}

const GENERATE_INPUT = {
  template: 'Dear {{customer_name}}, your Bharat Gas agency has been transferred to {{agency_name}}.',
  customer: { customer_name: 'Ram', agency_name: 'Bharat Gas – Sector 12' },
  instructions: 'Keep it concise',
  tone: 'professional',
};

const IMPROVE_INPUT = {
  message: 'Hello {{customer_name}}, your refill is ready at {{agency_name}}.',
  instructions: 'Make it more professional',
  tone: 'friendly',
};

describe('AiService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an OpenAI chat completion request with the configured model and key', async () => {
    fetchMock.mockResolvedValue(okBody('Dear {{customer_name}}, ...', 'gpt-custom'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123', OPENAI_MODEL: 'gpt-custom' });

    await svc.generate({ template: 'Dear {{customer_name}}', customer: { customer_name: 'Ram' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-openai-123' });
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.model).toBe('gpt-custom');
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].role).toBe('system');
  });

  it('sends a DeepSeek chat completion request with the configured model and key', async () => {
    fetchMock.mockResolvedValue(okBody('Dear {{customer_name}}, ...', 'deepseek-custom'));
    const svc = makeService({
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-deepseek-123',
      DEEPSEEK_MODEL: 'deepseek-custom',
      OPENAI_API_KEY: 'sk-openai-123',
    });

    await svc.generate({ template: 'Dear {{customer_name}}', customer: { customer_name: 'Ram' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-deepseek-123' });
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.model).toBe('deepseek-custom');
  });

  it('lets a per-request provider override the default AI_PROVIDER', async () => {
    fetchMock.mockResolvedValue(okBody('Hello {{customer_name}}', 'deepseek-model'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123', DEEPSEEK_API_KEY: 'sk-deepseek-123' });

    await svc.generate({ provider: 'deepseek', template: 'Hello {{customer_name}}', customer: { customer_name: 'Ram' } });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
  });

  it('uses the default provider when none is requested', async () => {
    fetchMock.mockResolvedValue(okBody('Hello {{customer_name}}', 'gpt-model'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    await svc.generate({ template: 'Hello {{customer_name}}', customer: { customer_name: 'Ram' } });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('rejects an unsupported provider with a clean 400', async () => {
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });
    await expect(
      svc.generate({ provider: 'anthropic' as any, template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 with a clean message when the provider API key is missing', async () => {
    const svc = makeService({ AI_PROVIDER: 'openai' });
    await expect(svc.generate({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    try {
      await svc.generate({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } });
    } catch (e) {
      expect((e as Error).message).toContain('not configured');
      expect((e as Error).message).not.toContain('sk-');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a provider HTTP error to 502 without leaking the API key', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
    const svc = makeService({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-deepseek-secret' });

    try {
      await svc.generate(GENERATE_INPUT);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadGatewayException);
      expect((e as Error).message).toContain('HTTP 429');
      expect((e as Error).message).toContain('rate limited');
      expect((e as Error).message).not.toContain('sk-deepseek-secret');
      expect((e as Error).message).not.toContain('Bearer');
      expect((e as Error).message).not.toContain('Authorization');
    }
  });

  it('maps a malformed/missing provider response to 502', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) });
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    await expect(svc.generate(GENERATE_INPUT)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps a network error to 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    await expect(svc.generate(GENERATE_INPUT)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns a consistent draft result on successful generation', async () => {
    fetchMock.mockResolvedValue(okBody('Dear {{customer_name}}, your Bharat Gas agency has been transferred to {{agency_name}}.', 'gpt-ok'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123', OPENAI_MODEL: 'gpt-ok' });

    const result = await svc.generate(GENERATE_INPUT);

    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-ok',
      draft: 'Dear {{customer_name}}, your Bharat Gas agency has been transferred to {{agency_name}}.',
      reviewRequired: true,
    });
  });

  it('returns an improved draft on successful improvement', async () => {
    fetchMock.mockResolvedValue(okBody('Good day {{customer_name}}, your refill is ready at {{agency_name}}.'));
    const svc = makeService({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-deepseek-123' });

    const result = await svc.improve(IMPROVE_INPUT);

    expect(result.provider).toBe('deepseek');
    expect(result.draft).toContain('{{customer_name}}');
    expect(result.draft).toContain('{{agency_name}}');
    expect(result.reviewRequired).toBe(true);
  });

  it('accepts a draft that preserves all template variables', async () => {
    fetchMock.mockResolvedValue(okBody('Dear {{customer_name}}, your new agency is {{agency_name}}.'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    const result = await svc.generate({
      template: 'Dear {{customer_name}}, welcome to {{agency_name}}.',
      customer: { customer_name: 'Ram', agency_name: 'Bharat Gas 12' },
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.draft).toContain('{{customer_name}}');
    expect(result.draft).toContain('{{agency_name}}');
  });

  it('rejects a draft that silently drops a required variable', async () => {
    fetchMock.mockResolvedValue(okBody('Dear {{customer_name}}, all good!'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    try {
      await svc.generate({
        template: 'Dear {{customer_name}}, your agency is now {{agency_name}}.',
        customer: { customer_name: 'Ram', agency_name: 'Bharat Gas 12' },
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain('agency_name');
      expect((e as Error).message).not.toContain('sk-');
    }
  });

  it('rejects a draft that silently drops a variable during improve', async () => {
    fetchMock.mockResolvedValue(okBody('Hello Ram, all set!'));
    const svc = makeService({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-deepseek-123' });

    await expect(svc.improve({ message: 'Hello {{customer_name}}, all set.' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps reviewRequired true for every generate and improve result', async () => {
    fetchMock.mockResolvedValue(okBody('Hi {{customer_name}}, keep your {{customer_name}} in mind.'));
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });

    const gen = await svc.generate({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } });
    const imp = await svc.improve({ message: 'Hi {{customer_name}}' });

    expect(gen.reviewRequired).toBe(true);
    expect(imp.reviewRequired).toBe(true);
  });

  it('has no method or dependency that can send WhatsApp messages', () => {
    const proto = AiService.prototype as any;
    const methods = Object.getOwnPropertyNames(proto);
    const sendLike = methods.filter((m) => /send|dispatch|publish|whatsapp|meta/i.test(m));
    expect(sendLike).toEqual([]);

    const svc = new AiService(new ProviderRegistry({ get: () => undefined } as any));
    expect((svc as any).wa).toBeUndefined();
    expect((svc as any).whatsapp).toBeUndefined();
    expect((svc as any).meta).toBeUndefined();
  });

  it('rejects customer values that are not strings', async () => {
    const svc = makeService({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai-123' });
    await expect(
      svc.generate({
        template: 'Hi {{customer_name}}',
        customer: { customer_name: 123 } as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exposes provider/model metadata on adapters only via the registry', async () => {
    const openai = new OpenAIProvider('sk-x', 'gpt-a', 1000);
    const deepseek = new DeepSeekProvider('sk-y', 'ds-b', 1000);
    expect(openai.provider).toBe('openai');
    expect(openai.model).toBe('gpt-a');
    expect(deepseek.provider).toBe('deepseek');
    expect(deepseek.model).toBe('ds-b');
  });
});