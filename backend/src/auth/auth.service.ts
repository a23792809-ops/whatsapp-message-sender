import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

export const SESSION_COOKIE_NAME = 'bg_session';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export interface SessionPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

export interface SessionToken {
  token: string;
  expiresAt: number;
}

export type AuthenticatedRequest = Request & { session?: SessionPayload };

/**
 * Stateless, signed-session authentication for a single admin operator.
 * Passwords are verified with Node's built-in scrypt KDF (timing-safe);
 * the session is a short HMAC-SHA256-signed JWT-style token carried in an
 * HttpOnly cookie. No plaintext passwords are ever stored.
 */
@Injectable()
export class AuthService {
  private readonly adminUsername: string | null;
  private readonly passwordHash: string | null;
  private readonly secret: string | null;
  private readonly sessionHours: number;
  private readonly cookieSecure: boolean;

  constructor(private readonly config: ConfigService) {
    this.adminUsername = config.get<string>('ADMIN_USERNAME') || null;
    this.passwordHash = config.get<string>('ADMIN_PASSWORD_HASH') || null;
    this.secret = config.get<string>('AUTH_SECRET') || null;
    const hours = Number(config.get<string>('AUTH_SESSION_HOURS') || 168);
    this.sessionHours = Number.isFinite(hours) && hours > 0 ? hours : 168;
    const isProd = config.get<string>('NODE_ENV') === 'production';
    this.cookieSecure = config.get<string>('AUTH_COOKIE_SECURE') === 'true' || isProd;
  }

  get isConfigured(): boolean {
    return Boolean(this.adminUsername && this.passwordHash && this.secret);
  }

  /** Derive a `scrypt$N$r$p$salt$hash` string from a plaintext password. */
  static async hashPassword(password: string): Promise<string> {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string.');
    }
    const salt = randomBytes(SALT_BYTES);
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  /** Constant-time verification of a plaintext password against an scrypt hash. */
  static async verifyPassword(password: string, stored: string): Promise<boolean> {
    if (typeof stored !== 'string' || typeof password !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
    const n = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) {
      return false;
    }
    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(saltB64, 'base64');
      expected = Buffer.from(hashB64, 'base64');
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(derived, expected);
  }

  /**
   * Verify admin credentials without leaking whether the username was right.
   * A failed username still triggers a dummy hash check to keep timings close.
   */
  async verifyCredentials(username: string, password: string): Promise<boolean> {
    if (!this.isConfigured || !this.adminUsername || !this.passwordHash) return false;
    const provided = Buffer.from(String(username));
    const expected = Buffer.from(this.adminUsername);
    const usernameOk = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!usernameOk) {
      await AuthService.verifyPassword(password, this.passwordHash);
      return false;
    }
    return AuthService.verifyPassword(password, this.passwordHash);
  }

  async signSession(username: string): Promise<SessionToken> {
    if (!this.isConfigured || !this.secret) {
      throw new Error('Admin authentication is not configured on the server.');
    }
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.sessionHours * 3600;
    const payload: SessionPayload = { sub: 'admin', username, iat, exp };
    return { token: this.sign(payload), expiresAt: exp * 1000 };
  }

  parseSession(token: string | null | undefined): SessionPayload | null {
    if (!token || !this.secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSig);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
      if (payload.sub !== 'admin' || typeof payload.username !== 'string') return null;
      return payload;
    } catch {
      return null;
    }
  }

  readSessionToken(req: Request): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      const name = part.slice(0, index).trim();
      if (name === SESSION_COOKIE_NAME) {
        try {
          return decodeURIComponent(part.slice(index + 1).trim());
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  attachSession(res: Response, token: string, expiresAt: number): void {
    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions(expiresAt));
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
    });
  }

  private sign(payload: SessionPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret!)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  private cookieOptions(expiresAt: number): Record<string, unknown> {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
      expires: new Date(expiresAt),
    };
  }
}