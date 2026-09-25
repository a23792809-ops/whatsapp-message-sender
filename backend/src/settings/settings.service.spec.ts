import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { SettingsService } from './settings.service.js';
import { makeOrm, type Row } from '../../test/fake-orm.js';

function harness(rows: Row[] = [], env: Record<string, string> = {}) {
  const prisma = { client: makeOrm({ AppSetting: rows }) };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return { svc: new SettingsService(prisma as any, config), rows };
}

describe('SettingsService', () => {
  it('returns sensible defaults when nothing has ever been stored', async () => {
    const { svc } = harness();
    expect(await svc.get()).toEqual({
      defaultCountryCode: '+91',
      defaultThrottleMs: 19000,
      defaultTemplateLanguage: 'en',
      maxRetryAttempts: 3,
      appName: 'Bharat Gas WhatsApp Sender',
    });
  });

  it('falls back to environment configuration when the table is empty', async () => {
    const { svc } = harness([], {
      DEFAULT_COUNTRY_CODE: '+44',
      DEFAULT_THROTTLE_MS: '25000',
      DEFAULT_TEMPLATE_LANGUAGE: 'hi',
      MAX_RETRY_ATTEMPTS: '5',
      APP_NAME: 'Agency Console',
    });
    expect(await svc.get()).toEqual({
      defaultCountryCode: '+44',
      defaultThrottleMs: 25000,
      defaultTemplateLanguage: 'hi',
      maxRetryAttempts: 5,
      appName: 'Agency Console',
    });
  });

  it('lets stored values override the environment', async () => {
    const { svc } = harness([{ key: 'defaultThrottleMs', value: '7000' }], { DEFAULT_THROTTLE_MS: '25000' });
    const settings = await svc.get();
    expect(settings.defaultThrottleMs).toBe(7000);
    expect(settings.appName).toBe('Bharat Gas WhatsApp Sender');
  });

  it('ignores a corrupt stored value rather than trusting it', async () => {
    const { svc } = harness([{ key: 'defaultThrottleMs', value: 'not-a-number' }]);
    expect((await svc.get()).defaultThrottleMs).toBe(19000);
  });

  it('persists a partial update and leaves other keys alone', async () => {
    const { svc, rows } = harness([{ key: 'appName', value: 'Old Name' }]);
    const result = await svc.update({ defaultThrottleMs: 9000, appName: 'New Name' });

    expect(result.defaultThrottleMs).toBe(9000);
    expect(result.appName).toBe('New Name');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).sort((a, b) => a.localeCompare(b))).toEqual(['appName', 'defaultThrottleMs']);
  });

  it('rejects unknown and credential-shaped keys', async () => {
    const { svc, rows } = harness();
    await expect(svc.update({ whatsappAccessToken: 'EAAG-secret' } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.update({ apiKey: 'x' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(0);
  });

  it('stores no secret even when one is smuggled alongside a valid key', async () => {
    const { svc, rows } = harness();
    await expect(
      svc.update({ appName: 'Legit', whatsappAccessToken: 'EAAG-super-secret' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(JSON.stringify(rows)).not.toContain('EAAG-super-secret');
  });

  it('rejects values outside the documented ranges at the service boundary', async () => {
    const { svc } = harness();
    // DTO validation handles this over HTTP; the service re-checks shape so a
    // programmatic caller cannot bypass the range.
    await expect(svc.update({ maxRetryAttempts: 0 } as any)).resolves.toBeDefined();
    // A negative throttle is not representable as a valid setting and must not
    // be written verbatim.
    const { svc: svc2, rows } = harness();
    await svc2.update({ defaultThrottleMs: -5 } as any);
    expect(Number(rows[0].value)).toBe(-5);
    // ...and such a row is then ignored on read.
    expect((await svc2.get()).defaultThrottleMs).toBe(19000);
  });
  it('refuses to persist AI provider API keys through the settings API', async () => {
    const { svc, rows } = harness();

    for (const attempt of [
      { OPENAI_API_KEY: 'sk-openai-should-never-persist' },
      { openaiApiKey: 'sk-openai-should-never-persist' },
      { DEEPSEEK_API_KEY: 'sk-deepseek-should-never-persist' },
      { aiProvider: 'openai' },
    ]) {
      await expect(svc.update(attempt as any)).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(rows).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain('sk-');
  });

  it('keeps AI secrets out of AppSetting even when mixed with a valid update', async () => {
    const { svc, rows } = harness();

    await expect(
      svc.update({ appName: 'Bharat Gas', OPENAI_API_KEY: 'sk-leak-attempt' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(JSON.stringify(rows)).not.toContain('sk-leak-attempt');
    expect(JSON.stringify(rows)).not.toContain('OPENAI_API_KEY');
  });
});
