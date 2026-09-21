'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import {
  api,
  CustomerMeta,
  CustomerPreviewResponse,
  CustomerSummary,
  CustomerUploadResponse,
  TemplateSummary,
  UploadRowIssue,
} from '@/lib/api';
import {
  Users,
  Upload,
  Search,
  CheckCircle2,
  AlertOctagon,
  Clock,
  Send,
  FileSpreadsheet,
  AlertCircle,
  Eye,
  RefreshCw,
  Tag,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const PAGE_SIZES = [10, 25, 50, 100];

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [meta, setMeta] = useState<CustomerMeta | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter (server-driven)
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Upload Modal State (two-phase: preview -> confirm import)
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewResult, setPreviewResult] = useState<CustomerPreviewResponse | null>(null);
  const [uploadResult, setUploadResult] = useState<CustomerUploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Customer Detail / Quick Send Modal
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [quickSendTemplateId, setQuickSendTemplateId] = useState<string>('');
  const [sendingQuickMessage, setSendingQuickMessage] = useState(false);
  const [quickSendFeedback, setQuickSendFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await api.customers.list({
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
        pageSize,
      });
      setCustomers(res.data);
      setMeta(res.meta);
      if (page > res.meta.totalPages) {
        setPage(res.meta.totalPages);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load customer list.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedSearch, statusFilter, page, pageSize]);

  useEffect(() => {
    setLoading(true);
    fetchCustomers();
  }, [fetchCustomers]);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.templates.list();
      if (res && res.length > 0) {
        setTemplates(res);
        setQuickSendTemplateId((prev) => prev || res[0].id);
      }
    } catch {
      /* templates are optional on this page */
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchCustomers();
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setAppliedSearch(searchQuery.trim());
    setPage(1);
  };

  const handleStatusChange = (tab: string) => {
    setStatusFilter(tab);
    setPage(1);
  };

  const fromCount = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const toCount = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  // Handle File Upload (Preview then Import)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadError(null);
      setPreviewResult(null);
      setUploadResult(null);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      setUploadError('Please choose a CSV or Excel (.xlsx) file to preview.');
      return;
    }
    try {
      setPreviewing(true);
      setUploadError(null);
      setUploadResult(null);
      const res = await api.customers.preview(selectedFile);
      setPreviewResult(res);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to parse customer file.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;
    try {
      setImporting(true);
      setUploadError(null);
      const res = await api.customers.upload(selectedFile);
      setUploadResult(res);
      fetchCustomers();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to import customer file.');
    } finally {
      setImporting(false);
    }
  };

  // Handle Quick Send Message
  const handleSendSingleMessage = async () => {
    if (!selectedCustomer || !quickSendTemplateId) return;
    try {
      setSendingQuickMessage(true);
      setQuickSendFeedback(null);
      const res = await api.messages.send(selectedCustomer.id, quickSendTemplateId);
      if (res.ok) {
        setQuickSendFeedback({
          ok: true,
          message: `Message dispatched successfully to ${selectedCustomer.name} (${selectedCustomer.mobile})`,
        });
        fetchCustomers();
      } else {
        setQuickSendFeedback({
          ok: false,
          message: res.error || 'Failed to deliver message via WhatsApp gateway.',
        });
      }
    } catch (err: unknown) {
      setQuickSendFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to send individual message.',
      });
    } finally {
      setSendingQuickMessage(false);
    }
  };

  const formatVariables = (jsonStr?: string | null): [string, string][] | null => {
    if (!jsonStr) return null;
    try {
      const obj = JSON.parse(jsonStr);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      return Object.entries(obj).map(([k, v]) => [String(k), String(v)]);
    } catch {
      return null;
    }
  };

  const renderIssueList = (
    title: string,
    tone: 'rose' | 'amber' | 'slate',
    issues: UploadRowIssue[],
  ) => {
    if (issues.length === 0) return null;
    const colors: Record<string, string> = {
      rose: 'text-rose-700',
      amber: 'text-amber-700',
      slate: 'text-slate-700',
    };
    return (
      <div className="flex-1 min-w-[180px]">
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${colors[tone]}`}>
          {title} ({issues.length})
        </div>
        <div className="max-h-28 overflow-y-auto bg-white border border-slate-200 rounded-md p-2 text-[11px] text-slate-600">
          {issues.map((issue, idx) => (
            <div key={idx}>
              Row {issue.row}: {issue.reason}
              {issue.mobile ? ` (${issue.mobile})` : ''}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <AppShell onRefresh={handleRefresh} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider">
                LPG Consumer Registry
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              Customer Management
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Import, filter, and inspect Bharat Gas consumer contact numbers and dynamic template variables.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                setUploadModalOpen(true);
                setSelectedFile(null);
                setPreviewResult(null);
                setUploadResult(null);
                setUploadError(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs hover:shadow transition-all active:scale-98"
            >
              <Upload className="h-4 w-4" />
              Upload Customers (CSV / XLSX)
            </button>
          </div>
        </div>

        {/* Global Connection Warning */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800">
              <span className="font-semibold block mb-0.5">Notice:</span>
              {error}
            </div>
          </div>
        )}

        {/* Summary Stat Strips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Total Consumers</span>
              <Users className="h-4 w-4 text-[#007BC9]" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
              {loading ? '—' : (meta?.total ?? 0).toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-700 uppercase">Delivered</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-700 mt-2">
              {loading ? '—' : (meta?.byStatus.sent ?? 0).toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-700 uppercase">Pending</span>
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-amber-700 mt-2">
              {loading ? '—' : (meta?.byStatus.pending ?? 0).toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-rose-700 uppercase">Failed / Invalid</span>
              <AlertOctagon className="h-4 w-4 text-rose-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-rose-700 mt-2">
              {loading ? '—' : (meta?.byStatus.failed ?? 0).toLocaleString()}
            </div>
          </Card>
        </div>

        {/* Search, Filter & Table */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by customer name, mobile number, or variables (press Enter)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-16 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-800 placeholder-slate-400 transition-all"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 text-[11px] font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md transition-colors"
                >
                  Search
                </button>
              </form>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 self-start sm:self-auto">
                {(['ALL', 'SENT', 'PENDING', 'FAILED'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => handleStatusChange(tab)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      statusFilter === tab
                        ? 'bg-white text-[#007BC9] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'ALL' ? 'All Records' : tab}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 bg-slate-100 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : customers.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Users}
                  title={(meta?.total ?? 0) === 0 ? 'No customers imported yet' : 'No customers match your filter'}
                  description={
                    (meta?.total ?? 0) === 0
                      ? 'Upload your Bharat Gas consumer CSV or Excel list containing Customer Names, Mobile Numbers, and dynamic refill variables.'
                      : 'Try adjusting your search keywords or switching the status filter.'
                  }
                  actionLabel={(meta?.total ?? 0) === 0 ? 'Upload Customers' : undefined}
                  actionIcon={Upload}
                  onAction={() => setUploadModalOpen(true)}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Customer Name</th>
                      <th className="px-4 py-3">Mobile Number</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Custom Variables</th>
                      <th className="px-4 py-3">Last Attempt</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((cust) => {
                      const vars = formatVariables(cust.variables);
                      return (
                        <tr key={cust.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-900 flex items-center gap-2">
                              <span>{cust.name}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">ID: {cust.id}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              +91 {cust.mobile}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={cust.status || 'PENDING'} />
                          </td>
                          <td className="px-4 py-3.5">
                            {vars && vars.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {vars.slice(0, 3).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-800 px-1.5 py-0.2 rounded border border-blue-200 truncate max-w-[140px]"
                                    title={`${k}: ${v}`}
                                  >
                                    <span className="font-bold">{k}:</span> {v}
                                  </span>
                                ))}
                                {vars.length > 3 && (
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    +{vars.length - 3} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">Standard</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {cust.lastAttempt
                              ? new Date(cust.lastAttempt).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => {
                                setSelectedCustomer(cust);
                                setQuickSendFeedback(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-orange-600 bg-white hover:bg-orange-50 border border-slate-200 hover:border-orange-200 rounded-md transition-all shadow-2xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Details & Send</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Footer */}
            {!loading && meta && meta.total > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50/60">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>
                    Showing {fromCount.toLocaleString()}–{toCount.toLocaleString()} of{' '}
                    <span className="font-semibold text-slate-700">{meta.total.toLocaleString()}</span> records
                  </span>
                  <div className="flex items-center gap-1 ml-2">
                    <span>Rows:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-orange-500"
                    >
                      {PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={meta.page <= 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-md transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev
                  </button>
                  <span className="text-[11px] text-slate-600 font-semibold min-w-[70px] text-center">
                    Page {meta.page} of {meta.totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                    disabled={meta.page >= meta.totalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-md transition-colors"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upload Customer Modal (Preview -> Confirm) */}
        <Modal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          title="Upload Bharat Gas Customer File"
          description={
            uploadResult
              ? 'Import summary for the latest file'
              : previewResult
                ? 'Review validation results before importing'
                : 'Preview the file to validate records before importing'
          }
          maxWidth="xl"
        >
          <div className="space-y-4">
            {/* Upload Area */}
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <input
                type="file"
                id="customer-file-input"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="customer-file-input"
                className="cursor-pointer flex flex-col items-center justify-center"
              >
                <div className="h-12 w-12 rounded-xl bg-orange-100/80 border border-orange-200 flex items-center justify-center text-orange-600 mb-3 shadow-xs">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <span className="text-xs font-bold text-slate-800 hover:text-orange-600">
                  {selectedFile ? selectedFile.name : 'Click to select CSV / XLSX file'}
                </span>
                <span className="text-[11px] text-slate-400 mt-1">
                  Supports .csv, .xlsx, .xls (Up to 10MB)
                </span>
              </label>
            </div>

            {/* Expected CSV Header Reference */}
            <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-xs space-y-1.5 text-blue-950">
              <div className="font-bold flex items-center gap-1.5 text-blue-900">
                <Tag className="h-3.5 w-3.5 text-orange-600" />
                Recognized Column Names:
              </div>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                <strong>Mandatory:</strong> <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Customer Name</code>,{' '}
                <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Mobile No</code>
              </p>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                <strong>Optional Dynamic Variables:</strong> <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Consumer No</code>,{' '}
                <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Refill Date</code>,{' '}
                <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Booking ID</code>,{' '}
                <code className="bg-white/80 px-1 py-0.5 rounded border border-blue-200">Agency Name</code>
              </p>
            </div>

            {/* Upload Error Banner */}
            {uploadError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>{uploadError}</div>
              </div>
            )}

            {/* Preview Validation Report (before import) */}
            {previewResult && !uploadResult && (
              <div className="p-3.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 space-y-3">
                <div className="font-bold flex items-center gap-1.5 text-blue-800">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  Validation Preview for {previewResult.filename}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-center font-semibold">
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Total Rows</div>
                    <div className="text-sm font-bold text-slate-800">{previewResult.totalRows}</div>
                  </div>
                  <div className="p-2 bg-emerald-50 rounded border border-emerald-200">
                    <div className="text-[10px] text-emerald-600 uppercase">Ready to Import</div>
                    <div className="text-sm font-bold text-emerald-700">{previewResult.validCount}</div>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Already Exists</div>
                    <div className="text-sm font-bold text-blue-700">{previewResult.existsCount}</div>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <div className="text-[10px] text-amber-600 uppercase">Duplicates</div>
                    <div className="text-sm font-bold text-amber-700">{previewResult.duplicateCount}</div>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <div className="text-[10px] text-rose-600 uppercase">Invalid</div>
                    <div className="text-sm font-bold text-rose-700">{previewResult.invalidCount}</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  {renderIssueList('Invalid rows', 'rose', previewResult.invalid)}
                  {renderIssueList('Duplicates in file', 'amber', previewResult.duplicate)}
                  {renderIssueList('Already in database', 'slate', previewResult.exists)}
                </div>

                {previewResult.sample.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Sample of rows ready to import
                    </div>
                    <div className="max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-md">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-2.5 py-1.5">Row</th>
                            <th className="px-2.5 py-1.5">Name</th>
                            <th className="px-2.5 py-1.5">Mobile</th>
                            <th className="px-2.5 py-1.5">Variables</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewResult.sample.map((row) => (
                            <tr key={row.row}>
                              <td className="px-2.5 py-2 text-slate-400">{row.row}</td>
                              <td className="px-2.5 py-2 font-semibold text-slate-800">{row.name}</td>
                              <td className="px-2.5 py-2 font-mono text-slate-600">{row.mobile}</td>
                              <td className="px-2.5 py-2">
                                <div className="flex flex-wrap gap-1">
                                  {row.variables
                                    ? Object.entries(row.variables)
                                        .filter(([k]) => !['mobile_no', 'customer_name'].includes(k))
                                        .map(([k, v]) => (
                                          <span
                                            key={k}
                                            className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded border border-blue-200"
                                          >
                                            <span className="font-bold">{k}:</span> {String(v)}
                                          </span>
                                        ))
                                    : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Import Success Report (after confirmed import) */}
            {uploadResult && (
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Import Completed Successfully
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-1 font-semibold">
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-slate-500 uppercase">Total Rows</div>
                    <div className="text-sm font-bold text-slate-800">{uploadResult.totalRows}</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-emerald-600 uppercase">Imported</div>
                    <div className="text-sm font-bold text-emerald-700">{uploadResult.insertedCount}</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-blue-600 uppercase">Already Existing</div>
                    <div className="text-sm font-bold text-blue-700">{uploadResult.existsCount}</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-amber-600 uppercase">Duplicates</div>
                    <div className="text-sm font-bold text-amber-700">{uploadResult.duplicateCount}</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-rose-600 uppercase">Invalid</div>
                    <div className="text-sm font-bold text-rose-700">{uploadResult.invalidCount}</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-emerald-200">
                    <div className="text-[10px] text-slate-500 uppercase">Skipped</div>
                    <div className="text-sm font-bold text-slate-700">{uploadResult.skippedCount}</div>
                  </div>
                </div>

                {uploadResult.invalid && uploadResult.invalid.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-600 max-h-24 overflow-y-auto bg-white p-2 rounded border border-slate-200">
                    <div className="font-semibold text-rose-700 mb-1">Skipped row details:</div>
                    {uploadResult.invalid.map((inv, idx) => (
                      <div key={idx} className="text-slate-600">
                        Row {inv.row}: {inv.reason} {inv.mobile ? `(${inv.mobile})` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {uploadResult ? 'Done' : 'Close'}
              </button>

              {!previewResult && !uploadResult && (
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={!selectedFile || previewing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
                >
                  {previewing ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Validating Records...
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5" />
                      Parse & Preview
                    </>
                  )}
                </button>
              )}

              {previewResult && !uploadResult && (
                <>
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={previewing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-preview
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={importing || previewResult.validCount === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
                  >
                    {importing ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Importing {previewResult.validCount} Records...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirm & Import ({previewResult.validCount})
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>

        {/* Customer Details & Single Message Dispatch Modal */}
        <Modal
          isOpen={!!selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          title={selectedCustomer ? `Consumer: ${selectedCustomer.name}` : 'Customer Details'}
          description="View consumer record variables and dispatch individual WhatsApp communication"
          maxWidth="lg"
        >
          {selectedCustomer && (
            <div className="space-y-4">
              {/* Record Summary */}
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Mobile Number</span>
                  <span className="font-mono font-semibold text-slate-800 text-sm">
                    +91 {selectedCustomer.mobile}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Current Status</span>
                  <StatusBadge status={selectedCustomer.status || 'PENDING'} />
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Database ID</span>
                  <span className="font-mono text-[11px] text-slate-600 truncate block">
                    {selectedCustomer.id}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Last Attempt</span>
                  <span className="font-mono text-[11px] text-slate-600">
                    {selectedCustomer.lastAttempt
                      ? new Date(selectedCustomer.lastAttempt).toLocaleString()
                      : 'Never contacted'}
                  </span>
                </div>
              </div>

              {/* Imported Dynamic Variables */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-orange-600" />
                  Dynamic Template Variables
                </h4>
                {selectedCustomer.variables ? (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5 font-mono">
                    {formatVariables(selectedCustomer.variables)?.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between py-1 border-b border-slate-200/60 last:border-0">
                        <span className="text-slate-500 font-semibold">{`{{${k}}}`}</span>
                        <span className="text-slate-900 font-bold bg-white px-2 py-0.5 rounded border border-slate-200">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-400 italic">
                    No custom variables found for this consumer. Default variables (customer_name, mobile_no) will be applied.
                  </div>
                )}
              </div>

              {/* Quick Individual Send Section */}
              <div className="p-4 rounded-xl border border-orange-200 bg-orange-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-orange-950 uppercase tracking-wider flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5 text-orange-600" />
                    Dispatch Single Message
                  </h4>
                  <span className="text-[10px] text-orange-800 font-medium">Direct WhatsApp Send</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Bharat Gas Message Template
                  </label>
                  <select
                    value={quickSendTemplateId}
                    onChange={(e) => setQuickSendTemplateId(e.target.value)}
                    className="w-full text-sm bg-white border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  >
                    {templates.length === 0 ? (
                      <option value="">No templates available</option>
                    ) : (
                      templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {quickSendFeedback && (
                  <div
                    className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                      quickSendFeedback.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {quickSendFeedback.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>{quickSendFeedback.message}</div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={sendingQuickMessage || !quickSendTemplateId}
                  onClick={handleSendSingleMessage}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
                >
                  {sendingQuickMessage ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Sending WhatsApp Message...
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Send WhatsApp Message Now
                    </>
                  )}
                </button>
              </div>

              {/* Close Footer */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close Drawer
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}