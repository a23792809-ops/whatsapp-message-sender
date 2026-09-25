import { describe, it, expect } from 'vitest';
import { redactUrlForLog } from './redact-url.js';

describe('redactUrlForLog', () => {
  it('never leaks the Meta webhook verification token from the query string', () => {
    // Regression guard: the HTTP request logger used to log `req.originalUrl`
    // verbatim, which wrote the verification token to stdout on every
    // subscription handshake.
    const url = '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SUPER_SECRET&hub.challenge=12345';
    const out = redactUrlForLog(url);
    expect(out).not.toContain('SUPER_SECRET');
    expect(out).toContain('hub.verify_token=%5Bredacted%5D');
    // The non-sensitive parts must survive, otherwise the log stops being useful.
    expect(out).toContain('hub.mode=subscribe');
    expect(out).toContain('hub.challenge=12345');
  });

  it('leaves ordinary URLs completely untouched', () => {
    const url = '/messages?page=2&pageSize=50&status=DELIVERED&search=hello%20world';
    expect(redactUrlForLog(url)).toBe(url);
  });

  it('leaves a URL with no query string untouched', () => {
    expect(redactUrlForLog('/health')).toBe('/health');
  });

  it('handles empty and undefined input', () => {
    expect(redactUrlForLog('')).toBe('');
    expect(redactUrlForLog(undefined)).toBe('');
  });

  it.each([
    ['access_token', '/api?access_token=abc123'],
    ['token', '/api?token=abc123'],
    ['secret', '/api?secret=abc123'],
    ['password', '/api?password=abc123'],
    ['api_key', '/api?api_key=abc123'],
    ['apikey', '/api?apikey=abc123'],
    ['authorization', '/api?authorization=abc123'],
    ['verify_token', '/api?verify_token=abc123'],
  ])('redacts the %s parameter', (param, url) => {
    const out = redactUrlForLog(url);
    expect(out).not.toContain('abc123');
    expect(out).toContain(param);
  });

  it('redacts a sensitive param alongside other params without losing them', () => {
    const out = redactUrlForLog('/x?a=1&token=zzz&b=2');
    expect(out).not.toContain('zzz');
    expect(out).toContain('a=1');
    expect(out).toContain('b=2');
  });

  it('preserves a value that merely reads like a sensitive key name', () => {
    // Redaction keys on the parameter *name*, not the value. A user searching
    // messages for the word "token" is not a credential leak, and blanking it
    // would needlessly hide real query logging.
    expect(redactUrlForLog('/messages?search=token')).toBe('/messages?search=token');
  });

  it('preserves a query param whose name merely contains a sensitive word', () => {
    const url = '/messages?status=FAILED&page=1';
    expect(redactUrlForLog(url)).toBe(url);
  });

  it('still redacts when a sensitive name is reused as another param value', () => {
    // The name-based rule must win even when the same word appears as a value.
    const out = redactUrlForLog('/messages?search=token&access_token=zzz');
    expect(out).not.toContain('zzz');
  });
});
