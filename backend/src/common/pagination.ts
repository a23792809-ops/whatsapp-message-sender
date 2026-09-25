/**
 * Shared pagination clamping so every paginated endpoint bounds its inputs the
 * same way. Without this a caller could ask for an unbounded page and force the
 * database to materialise an arbitrarily large result.
 */
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

export function clampPage(page?: number | string | null): number {
  const value = Number(page ?? 1);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function clampPageSize(pageSize?: number | string | null): number {
  const value = Number(pageSize ?? PAGE_SIZE_DEFAULT);
  if (!Number.isFinite(value) || value < 1) return PAGE_SIZE_DEFAULT;
  return Math.min(PAGE_SIZE_MAX, Math.floor(value));
}
