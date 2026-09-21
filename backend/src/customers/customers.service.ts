import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { parse } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';

type ParsedRow = Record<string, unknown>;
type ClassifiedRow = {
  row: number;
  mobile: string | null;
  name: string | null;
  template: string | null;
  status: 'valid' | 'invalid' | 'duplicate' | 'exists';
  reason: string | null;
  variables: Record<string, string> | null;
};

const MAX_REPORT = 50;

export type CustomerListResult = {
  data: any[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    byStatus: { sent: number; failed: number; pending: number };
  };
};

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);
  constructor(private readonly prisma: PrismaService) {}

  private get customerApi(): any {
    return (this.prisma.client as any).orm?.public?.Customer;
  }

  private async parseFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.csv')) {
      return parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as ParsedRow[];
    }
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const wb = new ExcelJS.Workbook();
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      await wb.xlsx.load(ab);
      const ws = wb.worksheets[0];
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell, col) => {
        headers[col] = String(cell.value ?? '').trim();
      });
      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const obj: ParsedRow = {};
        headers.forEach((h, col) => {
          if (h) obj[h] = row.getCell(col).value;
        });
        rows.push(obj);
      });
      return rows;
    }
    throw new BadRequestException('Unsupported file. Use .csv, .xlsx, or .xls');
  }

  private pick(row: ParsedRow, keys: string[]): string {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  private normalizeVariables(r: ParsedRow): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(r)) {
      const key = String(rawKey)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        .replace(/[^a-zA-Z0-9_]/g, '');

      if (!key) continue;
      const value = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
      if (value !== '') variables[key] = value;
    }
    return variables;
  }

  private async existingMobiles(): Promise<Set<string>> {
    const api = this.customerApi;
    if (!api?.all) return new Set();
    const res = await api.all();
    const arr = Array.isArray(res) ? res : await res;
    return new Set(arr.map((c: any) => String(c.mobile)));
  }

  /**
   * Classify parsed rows, never mutating the database.
   * Statuses: valid | invalid | duplicate (same file) | exists (already in DB).
   */
  private classifyRows(rows: ParsedRow[], exists: Set<string>): ClassifiedRow[] {
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const rowNum = i + 2;
      const mobileRaw = this.pick(r, ['Mobile No.', 'Mobile No', 'mobile', 'Mobile', 'mobile_no', 'phone']);
      const nameRaw = this.pick(r, ['Customer Name', 'name', 'Name', 'customer_name']);
      const templateRaw = this.pick(r, ['Message Template', 'template', 'Template', 'message_template']);
      const variables = this.normalizeVariables(r);
      const mobile = mobileRaw.replace(/\D/g, '');

      if (!mobile) {
        return { row: rowNum, mobile: null, name: nameRaw || null, template: templateRaw || null, status: 'invalid', reason: 'Missing mobile number', variables };
      }
      if (mobile.length < 10 || mobile.length > 15) {
        return { row: rowNum, mobile, name: nameRaw || null, template: templateRaw || null, status: 'invalid', reason: 'Invalid mobile length', variables };
      }
      if (!nameRaw) {
        return { row: rowNum, mobile, name: null, template: templateRaw || null, status: 'invalid', reason: 'Missing customer name', variables };
      }
      if (seen.has(mobile)) {
        return { row: rowNum, mobile, name: nameRaw, template: templateRaw || null, status: 'duplicate', reason: 'Duplicate mobile in file', variables };
      }
      seen.add(mobile);
      if (exists.has(mobile)) {
        return { row: rowNum, mobile, name: nameRaw, template: templateRaw || null, status: 'exists', reason: 'Already exists in database', variables };
      }
      return { row: rowNum, mobile, name: nameRaw, template: templateRaw || null, status: 'valid', reason: null, variables };
    });
  }

  private summarize(classified: ClassifiedRow[]) {
    const byStatus = (status: ClassifiedRow['status']) => classified.filter((r) => r.status === status);
    const toEntry = (r: ClassifiedRow): { row: number; mobile?: string; reason: string } => ({
      row: r.row,
      mobile: r.mobile ?? undefined,
      reason: r.reason ?? 'Unknown',
    });

    return {
      rows: classified,
      counts: {
        validCount: byStatus('valid').length,
        duplicateCount: byStatus('duplicate').length,
        existsCount: byStatus('exists').length,
        invalidCount: byStatus('invalid').length,
        missingRequiredCount: byStatus('invalid').filter((r) => (r.reason ?? '').startsWith('Missing')).length,
      },
      lists: {
        invalid: byStatus('invalid').slice(0, MAX_REPORT).map(toEntry),
        duplicate: byStatus('duplicate').slice(0, MAX_REPORT).map(toEntry),
        exists: byStatus('exists').slice(0, MAX_REPORT).map(toEntry),
      },
    };
  }

  /**
   * Preview: parse + validate + classify. Inserts nothing.
   */
  async previewFromBuffer(buffer: Buffer, filename: string) {
    const rows = await this.parseFile(buffer, filename);
    const exists = await this.existingMobiles();
    const classified = this.classifyRows(rows, exists);
    const { counts, lists } = this.summarize(classified);

    const sample = classified
      .filter((r) => r.status === 'valid')
      .slice(0, 5)
      .map((r) => ({ row: r.row, mobile: r.mobile ?? '', name: r.name ?? '', variables: r.variables }));

    return {
      filename,
      totalRows: rows.length,
      ...counts,
      ...lists,
      sample,
    };
  }

  /**
   * Confirmed import: parse, classify, then insert ONLY brand-new valid rows.
   * Duplicate-in-file, already-existing, and invalid rows are skipped (never overwritten).
   */
  async importFromBuffer(buffer: Buffer, filename: string) {
    const rows = await this.parseFile(buffer, filename);
    const exists = await this.existingMobiles();
    const classified = this.classifyRows(rows, exists);
    const { counts, lists } = this.summarize(classified);
    const valid = classified.filter((r) => r.status === 'valid');
    const api = this.customerApi;

    let inserted = 0;
    if (valid.length > 0 && api) {
      const dataRows = valid.map((v) => ({
        mobile: v.mobile!,
        name: v.name!,
        template: v.template,
        variables: v.variables && Object.keys(v.variables).length > 0 ? JSON.stringify(v.variables) : null,
      }));

      if (typeof api.createAll === 'function') {
        try {
          const res = await api.createAll(dataRows);
          const arr = Array.isArray(res) ? res : await res;
          inserted = Array.isArray(arr) ? arr.length : dataRows.length;
        } catch (e) {
          this.logger.error('createAll failed: ' + (e as Error).message);
        }
      }

      if (inserted === 0 && typeof api.create === 'function') {
        for (const v of valid) {
          try {
            await api.create({
              data: {
                mobile: v.mobile!,
                name: v.name!,
                template: v.template,
                variables: v.variables && Object.keys(v.variables).length > 0 ? JSON.stringify(v.variables) : null,
              },
            });
            inserted++;
          } catch (e) {
            this.logger.warn(`DB insert failed (row ${v.row}): ${(e as Error).message}`);
          }
        }
      }
    }

    return {
      filename,
      totalRows: rows.length,
      ...counts,
      ...lists,
      insertedCount: inserted,
      skippedCount: counts.duplicateCount + counts.existsCount + counts.invalidCount,
    };
  }

  /**
   * Paginated, searchable, filterable customer list.
   * Returns { data, meta } with total / page / pageSize / totalPages.
   */
  async list(params: { search?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<CustomerListResult> {
    const api = this.customerApi;
    if (!api?.all) {
      return {
        data: [],
        meta: { total: 0, page: 1, pageSize: 25, totalPages: 1, byStatus: { sent: 0, failed: 0, pending: 0 } },
      };
    }
    const res = await api.all();
    let rows = Array.isArray(res) ? res : await res;

    // Global status counts (unfiltered) so the UI can show accurate stats.
    const byStatus = { sent: 0, failed: 0, pending: 0 };
    for (const c of rows) {
      const s = (c.status || 'PENDING').toUpperCase();
      if (s === 'SENT' || s === 'COMPLETED') byStatus.sent += 1;
      else if (s === 'FAILED') byStatus.failed += 1;
      else byStatus.pending += 1;
    }

    const q = (params.search ?? '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((c: any) =>
        String(c.name ?? '').toLowerCase().includes(q) ||
        String(c.mobile ?? '').includes(q) ||
        (c.variables && String(c.variables).toLowerCase().includes(q)),
      );
    }

    const status = (params.status ?? '').toUpperCase();
    if (status && status !== 'ALL') {
      rows = rows.filter((c: any) => {
        const s = (c.status || 'PENDING').toUpperCase();
        if (status === 'SENT') return s === 'SENT' || s === 'COMPLETED';
        if (status === 'PENDING') return s === 'PENDING' || s === 'DRAFT';
        if (status === 'FAILED') return s === 'FAILED';
        return s === status;
      });
    }

    const total = rows.length;
    const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 100));
    const page = Math.max(1, params.page ?? 1);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    return {
      data: rows.slice(start, start + pageSize),
      meta: { total, page, pageSize, totalPages, byStatus },
    };
  }
}