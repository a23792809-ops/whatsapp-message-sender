'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import {
  api,
  MessageSummary,
} from '@/lib/api';
import {
  MessageSquare,
  Search,
  CheckCircle2,
  AlertOctagon,
  Clock,
  Eye,
  AlertCircle,
  Copy,
} from 'lucide-react';

export default function MessagesPage() {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Inspect Modal
  const [inspectMessage, setInspectMessage] = useState<MessageSummary | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.messages.list();
      setMessages(res || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load message history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const res = await api.messages.list();
        if (!ignore) {
          setMessages(res || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load message history.');
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadInitial();
    return () => {
      ignore = true;
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMessages();
  };

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      const matchSearch =
        searchQuery === '' ||
        msg.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.mobile.includes(searchQuery) ||
        (msg.whatsappId && msg.whatsappId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (msg.content && msg.content.toLowerCase().includes(searchQuery.toLowerCase()));

      const upperStatus = (msg.status || 'PENDING').toUpperCase();
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'SENT' && upperStatus === 'SENT') ||
        (statusFilter === 'FAILED' && upperStatus === 'FAILED') ||
        (statusFilter === 'PENDING' && upperStatus === 'PENDING');

      return matchSearch && matchStatus;
    });
  }, [messages, searchQuery, statusFilter]);

  // Statistics
  const totalCount = messages.length;
  const sentCount = messages.filter((m) => (m.status || '').toUpperCase() === 'SENT').length;
  const failedCount = messages.filter((m) => (m.status || '').toUpperCase() === 'FAILED').length;
  const pendingCount = messages.filter((m) => (m.status || '').toUpperCase() === 'PENDING').length;

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell onRefresh={handleRefresh} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider">
                WhatsApp Dispatch Ledger
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              Message History & Logs
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Comprehensive audit log of every personalized Bharat Gas WhatsApp message sent, pending, or failed.
            </p>
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
              <span className="text-[11px] font-bold text-slate-500 uppercase">Total Messages</span>
              <MessageSquare className="h-4 w-4 text-[#007BC9]" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
              {loading ? '—' : totalCount.toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-700 uppercase">Sent (Delivered)</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-700 mt-2">
              {loading ? '—' : sentCount.toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-700 uppercase">Pending Queue</span>
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-amber-700 mt-2">
              {loading ? '—' : pendingCount.toLocaleString()}
            </div>
          </Card>
          <Card className="p-4 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-rose-700 uppercase">Failed / Errors</span>
              <AlertOctagon className="h-4 w-4 text-rose-600" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-rose-700 mt-2">
              {loading ? '—' : failedCount.toLocaleString()}
            </div>
          </Card>
        </div>

        {/* Search, Filter & Table */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by customer name, mobile, message content, or WhatsApp ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-800 placeholder-slate-400 transition-all"
                />
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 self-start sm:self-auto">
                {(['ALL', 'SENT', 'PENDING', 'FAILED'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      statusFilter === tab
                        ? 'bg-white text-[#007BC9] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'ALL' ? 'All Dispatches' : tab}
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
            ) : filteredMessages.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={MessageSquare}
                  title={totalCount === 0 ? 'No messages dispatched yet' : 'No messages match your filter'}
                  description={
                    totalCount === 0
                      ? 'Launch a broadcast campaign or send an individual message to see delivery logs.'
                      : 'Try adjusting your search criteria.'
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Date & Time</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Mobile</th>
                      <th className="px-4 py-3">Campaign / ID</th>
                      <th className="px-4 py-3">Message Preview</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">WhatsApp ID</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMessages.map((msg) => (
                      <tr key={msg.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {msg.createdAt
                            ? new Date(msg.createdAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-900">
                          {msg.customerName}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-slate-700 whitespace-nowrap">
                          +91 {msg.mobile}
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 font-mono text-[11px] truncate max-w-[120px]">
                          {msg.campaignId ? (
                            <span className="text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                              {msg.campaignId.slice(0, 8)}...
                            </span>
                          ) : (
                            <span className="text-slate-400">Direct Send</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-slate-700 font-mono text-[11px] max-w-xs truncate">
                          {msg.content || '—'}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusBadge status={msg.status} />
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 font-mono text-[10px] truncate max-w-[120px]">
                          {msg.whatsappId || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => setInspectMessage(msg)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-orange-600 bg-white hover:bg-orange-50 border border-slate-200 hover:border-orange-200 rounded-md transition-all shadow-2xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Message Inspector Modal */}
        <Modal
          isOpen={!!inspectMessage}
          onClose={() => setInspectMessage(null)}
          title="WhatsApp Message Inspector"
          description="Detailed delivery ledger, payload content, Meta Cloud response IDs and error diagnostic traces"
          maxWidth="xl"
        >
          {inspectMessage && (
            <div className="space-y-4">
              {/* Header Status Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Delivery Status</span>
                  <StatusBadge status={inspectMessage.status} />
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Recipient</span>
                  <span className="font-semibold text-slate-800">{inspectMessage.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Mobile</span>
                  <span className="font-mono text-slate-700">+91 {inspectMessage.mobile}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Attempt Count</span>
                  <span className="font-mono text-slate-700">{inspectMessage.attemptCount || 1}</span>
                </div>
              </div>

              {/* Message Content Bubble */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Full Rendered WhatsApp Content:
                  </label>
                  <button
                    onClick={() => handleCopyText(inspectMessage.content)}
                    className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? 'Copied!' : 'Copy Text'}
                  </button>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {inspectMessage.content || 'Content not rendered yet (Pending in queue).'}
                </div>
              </div>

              {/* Error Trace if Failed */}
              {inspectMessage.error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-800">
                    <AlertOctagon className="h-4 w-4 text-rose-600" />
                    Gateway Error Reason:
                  </div>
                  <div className="font-mono text-[11px] bg-white p-2 rounded border border-rose-200 text-rose-800">
                    {inspectMessage.error}
                  </div>
                </div>
              )}

              {/* Meta Cloud WhatsApp ID */}
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs space-y-1 text-blue-950">
                <div className="font-bold text-blue-900">Meta Cloud WhatsApp Message ID:</div>
                <div className="font-mono text-[11px] text-blue-800 break-all">
                  {inspectMessage.whatsappId || 'Awaiting dispatch confirmation from gateway'}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setInspectMessage(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}
