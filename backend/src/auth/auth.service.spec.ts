import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { AuthService, SESSION_COOKIE_NAME } from './auth.service.js';

type EnvMap = Record<string, string | undefined>;

function makeService(config: EnvMap): { auth: AuthService; setCookie: ReturnType<typeof vi.fn> } {
  const env: ConfigService = {
    get: (key: string) => config[key] ?? undefined,
  } as unknown as ConfigService;
  const setCookie = vi.fn();
  const res = { cookie: setCookie, clearCookie: vi.fn() } as unknown as Response;
  return { auth: new AuthService(env), setCookie };
}

function configuredEnv(overrides: EnvMap = {}): EnvMap {
  return {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==',
    AUTH_SECRET: 'test-secret',
    AUTH_SESSION_HOURS: '168',
    AUTH_COOKIE_SECURE: 'false',
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('AuthService', () => {
  describe('hashPassword / verifyPassword', () => {
    it('produces an scrypt-formatted hash that verifies', async () => {
      const hash = await AuthService.hashPassword('sup3r-secret!');
      expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
      await expect(AuthService.verifyPassword('sup3r-secret!', hash)).resolves.toBe(true);
      await expect(AuthService.verifyPassword('wrong', hash)).resolves.toBe(false);
    });

    it('rejects a malformed stored hash without throwing', async () => {
      await expect(AuthService.verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
      await expect(AuthService.verifyPassword('x', '')).resolves.toBe(false);
      await expect(AuthService.verifyPassword('', 'scrypt$16384$8$1$c2FsdA==$aGFzaA==')).resolves.toBe(false);
    });
  });

  describe('verifyCredentials', () => {
    it('returns true for the correct username and password', async () => {
      const hash = await AuthService.hashPassword('hunter2');
      const { auth } = makeService(configuredEnv({ ADMIN_PASSWORD_HASH: hash }));
      await expect(auth.verifyCredentials('admin', 'hunter2')).resolves.toBe(true);
    });

    it('returns false for a wrong password', async () => {
      const hash = await AuthService.hashPassword('hunter2');
      const { auth } = makeService(configuredEnv({ ADMIN_PASSWORD_HASH: hash }));
      await expect(auth.verifyCredentials('admin', 'nope')).resolves.toBe(false);
    });

    it('returns false for an unknown username', async () => {
      const hash = await AuthService.hashPassword('hunter2');
      const { auth } = makeService(configuredEnv({ ADMIN_PASSWORD_HASH: hash }));
      await expect(auth.verifyCredentials('not-admin', 'hunter2')).resolves.toBe(false);
    });

    it('returns false when the server is not configured', async () => {
      const { auth } = makeService(configuredEnv({ AUTH_SECRET: undefined }));
      await expect(auth.verifyCredentials('admin', 'anything')).resolves.toBe(false);
    });
  });

  describe('signSession / parseSession', () => {
    it('round-trips a valid session', async () => {
      const { auth } = makeService(configuredEnv());
      const { token, expiresAt } = await auth.signSession('admin');
      expect(expiresAt).toBeGreaterThan(Date.now());
      const payload = auth.parseSession(token);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe('admin');
      expect(payload!.username).toBe('admin');
    });

    it('rejects a tampered token', async () => {
      const { auth } = makeService(configuredEnv());
      const { token } = await auth.signSession('admin');
      const [header, , signature] = token.split('.');
      const tamperedBody = Buffer.from(
        JSON.stringify({ sub: 'admin', username: 'attacker', iat: 1, exp: 9999999999 }),
      ).toString('base64url');
      expect(auth.parseSession(`${header}.${tamperedBody}.${signature}`)).toBeNull();
    });

    it('rejects an expired token', async () => {
      const { auth } = makeService(configuredEnv());
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({ sub: 'admin', username: 'admin', iat: 1, exp: Math.floor(Date.now() / 1000) - 10 }),
      ).toString('base64url');
      const signature = createHmac('sha256', 'test-secret').update(`${header}.${body}`).digest('base64url');
      expect(auth.parseSession(`${header}.${body}.${signature}`)).toBeNull();
    });

    it('rejects a token signed with a different secret', async () => {
      const { auth } = makeService(configuredEnv());
      const other = makeService(configuredEnv({ AUTH_SECRET: 'other-secret' }));
      const { token } = await other.auth.signSession('admin');
      expect(auth.parseSession(token)).toBeNull();
    });

    it('returns null for junk input', async () => {
      const { auth } = makeService(configuredEnv());
      expect(auth.parseSession(null)).toBeNull();
      expect(auth.parseSession('nothing')).toBeNull();
      expect(auth.parseSession('a.b')).toBeNull();
    });
  });

  describe('readSessionToken', () => {
    it('extracts the session cookie from the Cookie header', () => {
      const { auth } = makeService(configuredEnv());
      const req = { headers: { cookie: `other=x; ${SESSION_COOKIE_NAME}=abc123; more=y` } };
      expect(auth.readSessionToken(req as never)).toBe('abc123');
    });

    it('returns null when the cookie is absent', () => {
      const { auth } = makeService(configuredEnv());
      expect(auth.readSessionToken({ headers: {} } as never)).toBeNull();
      expect(auth.readSessionToken({ headers: { cookie: 'other=x' } } as never)).toBeNull();
    });

    it('url-decodes the cookie value', () => {
      const { auth } = makeService(configuredEnv());
      const value = `${Buffer.from('a b').toString('base64url')}.x.y`;
      const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}` } };
      expect(auth.readSessionToken(req as never)).toBe(value);
    });
  });

  describe('cookie helpers', () => {
    it('attachSession sets an HttpOnly, SameSite=Lax, secure-off cookie in dev', async () => {
      const { auth, setCookie } = makeService(configuredEnv());
      const { token, expiresAt } = await auth.signSession('admin');
      const res = { cookie: setCookie } as unknown as Response;
      auth.attachSession(res, token, expiresAt);
      expect(setCookie).toHaveBeenCalledTimes(1);
      const [name, value, options] = setCookie.mock.calls[0];
      expect(name).toBe(SESSION_COOKIE_NAME);
      expect(value).toBe(token);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.secure).toBe(false);
      expect(options.path).toBe('/');
      expect((options.expires as Date).getTime()).toBe(expiresAt);
    });

    it('marks the cookie Secure in production', async () => {
      const { auth, setCookie } = makeService(configuredEnv({ NODE_ENV: 'production' }));
      const { token, expiresAt } = await auth.signSession('admin');
      const res = { cookie: setCookie } as unknown as Response;
      auth.attachSession(res, token, expiresAt);
      const options = setCookie.mock.calls[0][2] as Record<string, unknown>;
      expect(options.secure).toBe(true);
    });

    it('marks the cookie Secure when AUTH_COOKIE_SECURE=true', async () => {
      const { auth, setCookie } = makeService(configuredEnv({ AUTH_COOKIE_SECURE: 'true' }));
      const { token, expiresAt } = await auth.signSession('admin');
      const res = { cookie: setCookie } as unknown as Response;
      auth.attachSession(res, token, expiresAt);
      const options = setCookie.mock.calls[0][2] as Record<string, unknown>;
      expect(options.secure).toBe(true);
    });
  });
});