import { describe, it, expect } from 'vitest';
import {
  normalizePhoneNumber,
  isValidMobile,
  formatVariables,
  filterCustomers,
  validateCustomerRow,
} from './customer-utils';
import type { CustomerSummary } from './api';

describe('customer-utils', () => {
  describe('normalizePhoneNumber', () => {
    it('strips dashes, spaces, and formatting characters from Indian mobile numbers', () => {
      expect(normalizePhoneNumber('+91 98765-43210')).toBe('9876543210');
      expect(normalizePhoneNumber('98765 43210')).toBe('9876543210');
    });

    it('strips leading 0 from 11-digit numbers', () => {
      expect(normalizePhoneNumber('09876543210')).toBe('9876543210');
    });

    it('strips 91 prefix from 12-digit numbers', () => {
      expect(normalizePhoneNumber('919876543210')).toBe('9876543210');
    });

    it('returns empty string for empty or missing input', () => {
      expect(normalizePhoneNumber('')).toBe('');
    });
  });

  describe('isValidMobile', () => {
    it('accepts valid 10 to 15 digit mobile numbers', () => {
      expect(isValidMobile('9876543210')).toBe(true);
      expect(isValidMobile('+91 98765 43210')).toBe(true);
      expect(isValidMobile('919876543210')).toBe(true);
    });

    it('rejects numbers that are too short or empty', () => {
      expect(isValidMobile('')).toBe(false);
      expect(isValidMobile('12345')).toBe(false);
      expect(isValidMobile('98765')).toBe(false);
    });

    it('rejects numbers that exceed 15 digits', () => {
      expect(isValidMobile('1234567890123456')).toBe(false);
    });
  });

  describe('formatVariables', () => {
    it('parses valid JSON string into an array of key-value tuples', () => {
      const json = JSON.stringify({
        consumer_no: 'CX-1002',
        booking_no: 'BK-5544',
      });
      const result = formatVariables(json);
      expect(result).toEqual([
        ['consumer_no', 'CX-1002'],
        ['booking_no', 'BK-5544'],
      ]);
    });

    it('returns null for null, undefined, or empty string', () => {
      expect(formatVariables(null)).toBeNull();
      expect(formatVariables(undefined)).toBeNull();
      expect(formatVariables('')).toBeNull();
    });

    it('returns null for malformed JSON or non-object types', () => {
      expect(formatVariables('{not valid json')).toBeNull();
      expect(formatVariables('["array", "not", "object"]')).toBeNull();
      expect(formatVariables('"string"')).toBeNull();
      expect(formatVariables('{}')).toBeNull();
    });
  });

  describe('filterCustomers', () => {
    const sampleCustomers: CustomerSummary[] = [
      { id: '1', name: 'Ramesh Patil', mobile: '9820011111', status: 'SENT' },
      { id: '2', name: 'Suresh Joshi', mobile: '9820022222', status: 'PENDING' },
      { id: '3', name: 'Sunita Sharma', mobile: '9820033333', status: 'FAILED' },
      { id: '4', name: 'Anjali Deshmukh', mobile: '9820044444', status: 'COMPLETED' },
    ];

    it('filters customers by case-insensitive name match', () => {
      const result = filterCustomers(sampleCustomers, 'ramesh');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Ramesh Patil');
    });

    it('filters customers by mobile substring match', () => {
      const result = filterCustomers(sampleCustomers, '22222');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Suresh Joshi');
    });

    it('filters customers by status', () => {
      const sent = filterCustomers(sampleCustomers, '', 'SENT');
      expect(sent.map((c) => c.name)).toEqual(['Ramesh Patil', 'Anjali Deshmukh']);

      const pending = filterCustomers(sampleCustomers, '', 'PENDING');
      expect(pending.map((c) => c.name)).toEqual(['Suresh Joshi']);

      const failed = filterCustomers(sampleCustomers, '', 'FAILED');
      expect(failed.map((c) => c.name)).toEqual(['Sunita Sharma']);
    });

    it('returns all customers when search is empty and status is ALL', () => {
      const result = filterCustomers(sampleCustomers, '', 'ALL');
      expect(result).toHaveLength(4);
    });
  });

  describe('validateCustomerRow', () => {
    const seen = new Set<string>(['9820011111']);
    const existing = new Set<string>(['9820099999']);

    it('validates a correct customer row', () => {
      const res = validateCustomerRow({ mobile: '9820055555', name: 'Amit Kumar' });
      expect(res.valid).toBe(true);
      expect(res.status).toBe('valid');
      expect(res.normalizedMobile).toBe('9820055555');
    });

    it('flags missing mobile number', () => {
      const res = validateCustomerRow({ mobile: '', name: 'Amit Kumar' });
      expect(res.valid).toBe(false);
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('Missing mobile number');
    });

    it('flags invalid mobile length', () => {
      const res = validateCustomerRow({ mobile: '12345', name: 'Amit Kumar' });
      expect(res.valid).toBe(false);
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('Invalid mobile length');
    });

    it('flags missing customer name', () => {
      const res = validateCustomerRow({ mobile: '9820055555', name: '' });
      expect(res.valid).toBe(false);
      expect(res.status).toBe('invalid');
      expect(res.reason).toBe('Missing customer name');
    });

    it('flags duplicate numbers inside the same file', () => {
      const res = validateCustomerRow({ mobile: '9820011111', name: 'Amit Kumar' }, seen);
      expect(res.valid).toBe(false);
      expect(res.status).toBe('duplicate');
      expect(res.reason).toBe('Duplicate mobile in file');
    });

    it('flags customers that already exist in the database', () => {
      const res = validateCustomerRow({ mobile: '9820099999', name: 'Amit Kumar' }, undefined, existing);
      expect(res.valid).toBe(false);
      expect(res.status).toBe('exists');
      expect(res.reason).toBe('Customer already exists in database');
    });
  });
});
