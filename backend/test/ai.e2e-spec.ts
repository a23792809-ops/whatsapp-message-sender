import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';

/**
 * AI assistant end-to-end coverage.
 *
 * The provider transport is stubbed with a fake global fetch, so this suite can
 * never reach OpenAI, DeepSeek, or Meta. It asserts the API contract, the
 * validation rules, the human-review gate, and that no credential is echoed
 * back to the client.
 */
describe('AI assistant (e2e)', () => {
  let app: INestApplication<App>;
  let cookie: string;

  /** Records the outbound provider call so we can inspect and forbid it. */
  const providerCalls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = url;
    // Any attempt to reach Meta (or anything that is not an AI provider) is a
    // hard failure: the AI assistant must never send a WhatsApp message.
    if (!u.includes('api.openai.com') && !u.includes('api.deepseek.com')) {
      throw new Error(`AI module attempted a non-AI outbound request: ${u}`);
    }
    providerCalls.push({ url: u, init: init ?? {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-e2e',
        model: 'gpt-e2e',
        choices: [{ message: { role: 'assistant', content: 'Dear {{customer_name}}, your refill is ready.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
      }),
    } as unknown as Response;
  });

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);

    // AI is optional: without credentials the app still boots, and AI calls
    // fail with a clean configuration error instead of crashing.
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword('e2e-password');
    process.env.AUTH_SECRET = 'e2e-test-secret';
    process.env.AUTH_SESSION_HOURS = '168';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'e2e-password' })
      .expect(201);
    cookie = String(login.headers['set-cookie'][0].split(';')[0]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_SESSION_HOURS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  beforeEach(() => {
    providerCalls.length = 0;
  });

  it('requires authentication for every AI endpoint', async () => {
    for (const path of ['/ai/generate', '/ai/improve', '/ai/personalize']) {
      await request(app.getHttpServer()).post(path).send({ template: 'Hi', message: 'Hi', customer: {} }).expect(401);
    }
    expect(providerCalls).toHaveLength(0);
  });

  it('returns a clean configuration error when the provider key is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/generate')
      .set('Cookie', cookie)
      .send({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } })
      .expect(503);

    expect(String(res.body.message)).toContain('not configured');
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|Bearer|Authorization/i);
    // A missing key must fail before any outbound request is attempted.
    expect(providerCalls).toHaveLength(0);
  });

  it('rejects an unknown provider with 400 and never calls out', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/generate')
      .set('Cookie', cookie)
      .send({ provider: 'anthropic', template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('provider');
    expect(providerCalls).toHaveLength(0);
  });

  it('validates the DTO: blank message, bad language and oversized instruction are rejected', async () => {
    await request(app.getHttpServer())
      .post('/ai/improve')
      .set('Cookie', cookie)
      .send({ message: '' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/ai/improve')
      .set('Cookie', cookie)
      .send({ message: 'Hi', language: 'not a language tag!' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/ai/improve')
      .set('Cookie', cookie)
      .send({ message: 'Hi', instructions: 'x'.repeat(2001) })
      .expect(400);

    // Personalize requires a customer variable map.
    await request(app.getHttpServer())
      .post('/ai/personalize')
      .set('Cookie', cookie)
      .send({ message: 'Hi {{customer_name}}' })
      .expect(400);

    expect(providerCalls).toHaveLength(0);
  });

  describe('with a configured provider', () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-e2e-secret-key';
    });

    afterEach(() => {
      delete process.env.AI_PROVIDER;
      delete process.env.OPENAI_API_KEY;
    });

    it('returns the documented contract with content, variables and usage', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Cookie', cookie)
        .send({ template: 'Dear {{customer_name}}, your refill is ready.', customer: { customer_name: 'Ram' } })
        .expect(201);

      expect(res.body).toMatchObject({
        provider: 'openai',
        model: 'gpt-e2e',
        content: 'Dear {{customer_name}}, your refill is ready.',
        variables: ['customer_name'],
        usage: { inputTokens: 11, outputTokens: 5 },
        reviewRequired: true,
      });

      // The AI key must never appear anywhere in the response.
      expect(JSON.stringify(res.body)).not.toContain('sk-e2e-secret-key');
      expect(JSON.stringify(res.body)).not.toMatch(/Bearer|Authorization/i);
    });

    it('sends the Authorization header server-side only', async () => {
      await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Cookie', cookie)
        .send({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } })
        .expect(201);

      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0].url).toBe('https://api.openai.com/v1/chat/completions');
      const headers = providerCalls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-e2e-secret-key');
    });

    it('keeps the system prompt guardrails in the outbound request', async () => {
      await request(app.getHttpServer())
        .post('/ai/generate')
        .set('Cookie', cookie)
        .send({ template: 'Hi {{customer_name}}', customer: { customer_name: 'Ram' } })
        .expect(201);

      const rawBody = providerCalls[0].init.body as string;
      const body = JSON.parse(rawBody);
      const system = String(body.messages[0].content);
      expect(system.toLowerCase()).toContain('never invent');
      expect(system.toLowerCase()).toContain('deceptive');
      expect(system.toLowerCase()).toContain('must not send');
    });

    it('personalizes a message and still requires human review', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/personalize')
        .set('Cookie', cookie)
        .send({
          message: 'Dear {{customer_name}}, your refill is ready.',
          customer: { customer_name: 'Ram' },
          language: 'en',
        })
        .expect(201);

      expect(res.body.content).toBe('Dear {{customer_name}}, your refill is ready.');
      expect(res.body.reviewRequired).toBe(true);
      expect(res.body.variables).toEqual(['customer_name']);
    });

    it('never sends a WhatsApp message: the only outbound call is the AI provider', async () => {
      await request(app.getHttpServer())
        .post('/ai/improve')
        .set('Cookie', cookie)
        .send({ message: 'Hi {{customer_name}}' })
        .expect(201);

      // Exactly one outbound request, and it went to OpenAI - never to Meta.
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0].url).not.toContain('graph.facebook.com');
      expect(providerCalls[0].url).not.toContain('whatsapp');
    });

    it('rejects a draft that drops a required template variable', async () => {
      // This model response silently replaces the placeholder with a literal
      // name, which must be refused rather than silently accepted.
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        const u = url;
        if (!u.includes('api.openai.com') && !u.includes('api.deepseek.com')) {
          throw new Error(`AI module attempted a non-AI outbound request: ${u}`);
        }
        providerCalls.push({ url: u, init: init ?? {} });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'gpt-e2e',
            choices: [{ message: { role: 'assistant', content: 'Hi Ram, all set.' } }],
          }),
        } as unknown as Response;
      });

      const res = await request(app.getHttpServer())
        .post('/ai/improve')
        .set('Cookie', cookie)
        .send({ message: 'Hi {{customer_name}}, all set.' })
        .expect(400);
      // The stub returns content without the variable, so the guard must fire.
      expect(String(res.body.message)).toContain('variable');
    });
  });
});
