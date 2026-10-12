import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, authErrorMessage } from './api';

describe('api client and error handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('ApiError', () => {
    it('sets status, statusText, and data properly', () => {
      const err = new ApiError(400, 'Bad Request', { message: 'Invalid payload' });
      expect(err.name).toBe('ApiError');
      expect(err.status).toBe(400);
      expect(err.statusText).toBe('Bad Request');
      expect(err.data).toEqual({ message: 'Invalid payload' });
      expect(err.message).toBe('API Error 400: Bad Request');
    });
  });

  describe('authErrorMessage', () => {
    it('extracts string message from error data object', () => {
      expect(authErrorMessage({ message: 'Session expired' }, 'Unauthorized')).toBe(
        'Session expired',
      );
    });

    it('extracts first item if message is an array of validation errors', () => {
      expect(
        authErrorMessage(
          { message: ['username should not be empty', 'password is too short'] },
          'Bad Request',
        ),
      ).toBe('username should not be empty');
    });

    it('falls back to statusText when message is not present', () => {
      expect(authErrorMessage(null, 'Forbidden')).toBe('Forbidden');
      expect(authErrorMessage({}, 'Service Unavailable')).toBe('Service Unavailable');
    });

    it('falls back to default message if both data and statusText are empty', () => {
      expect(authErrorMessage(null, '')).toBe('Authentication failed.');
    });
  });

  describe('request error handling', () => {
    it('throws friendly error message when network request fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(api.health.check()).rejects.toThrow(
        'Failed to fetch',
      );
    });

    it('dispatches bg:unauthorized event on 401 responses', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Unauthorized' }),
      } as Response);

      await expect(api.campaigns.list()).rejects.toThrow(ApiError);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bg:unauthorized' }),
      );
    });

    it('login converts 401 into "Invalid username or password."', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Wrong credentials' }),
      } as Response);

      await expect(api.auth.login('admin', 'wrongpass')).rejects.toThrow(
        'Invalid username or password.',
      );
    });
  });
});
