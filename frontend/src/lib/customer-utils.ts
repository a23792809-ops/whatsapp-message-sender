import type { CustomerSummary } from './api';

/**
 * Normalizes phone numbers by stripping non-digits.
 * Handles common Indian phone number formats (+91, 0 prefix, spaces, dashes).
 */
export function normalizePhoneNumber(raw: string): string {
  if (!raw) return '';
  const digitsOnly = raw.replace(/\D/g, '');

  // If 11 digits starting with 0, drop the leading 0 (e.g. 09876543210 -> 9876543210)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }

  // If 12 digits starting with 91, drop the country code for standard 10-digit display/matching
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }

  return digitsOnly;
}

/**
 * Validates whether a mobile number conforms to valid mobile requirements (10 to 15 digits).
 */
export function isValidMobile(raw: string): boolean {
  if (!raw) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Formats a JSON string of custom customer variables into a key-value tuple list for display.
 * Returns null if invalid or empty.
 */
export function formatVariables(jsonStr?: string | null): [string, string][] | null {
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const entries = Object.entries(obj).map(([k, v]) => [String(k), String(v)] as [string, string]);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Client-side filter for customer records matching a search query (name, mobile) and status.
 */
export function filterCustomers(
  customers: CustomerSummary[],
  searchQuery = '',
  statusFilter = 'ALL',
): CustomerSummary[] {
  const query = searchQuery.trim().toLowerCase();

  return customers.filter((cust) => {
    const matchesSearch =
      query === '' ||
      cust.name.toLowerCase().includes(query) ||
      cust.mobile.includes(query);

    const custStatus = (cust.status || 'PENDING').toUpperCase();
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'SENT' && (custStatus === 'SENT' || custStatus === 'COMPLETED')) ||
      (statusFilter === 'PENDING' && (custStatus === 'PENDING' || !cust.status)) ||
      (statusFilter === 'FAILED' && custStatus === 'FAILED');

    return matchesSearch && matchesStatus;
  });
}

export interface CustomerValidationResult {
  valid: boolean;
  status: 'valid' | 'invalid' | 'duplicate' | 'exists';
  reason?: string;
  normalizedMobile?: string;
}

/**
 * Client-side validation for an imported or manually entered customer record.
 */
export function validateCustomerRow(
  row: { mobile?: string | null; name?: string | null },
  seenInFile?: Set<string>,
  existingInDb?: Set<string>,
): CustomerValidationResult {
  const rawMobile = row.mobile ? String(row.mobile).trim() : '';
  const name = row.name ? String(row.name).trim() : '';

  if (!rawMobile) {
    return { valid: false, status: 'invalid', reason: 'Missing mobile number' };
  }

  const digits = rawMobile.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, status: 'invalid', reason: 'Invalid mobile length' };
  }

  if (!name) {
    return { valid: false, status: 'invalid', reason: 'Missing customer name' };
  }

  if (seenInFile && seenInFile.has(digits)) {
    return { valid: false, status: 'duplicate', reason: 'Duplicate mobile in file' };
  }

  if (existingInDb && existingInDb.has(digits)) {
    return { valid: false, status: 'exists', reason: 'Customer already exists in database' };
  }

  return { valid: true, status: 'valid', normalizedMobile: digits };
}
