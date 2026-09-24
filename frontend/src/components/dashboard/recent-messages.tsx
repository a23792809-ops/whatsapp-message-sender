'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { MessageSummary } from '@/lib/api';
import { StatusBadge } from '../ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { MessageSquare, ArrowUpRight, AlertCircle } from 'lucide-react';

interface RecentMessagesProps {
  messages: MessageSummary[];
  loading?: boolean;
  error?: string | null;
}

function maskMobile(mobile: string): string {
  const digits = (mobile || '').replace(/\D/g, '');
  if (!digits) return '—';
  return `+91 •••••• ${digits.slice(-4)}`;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

export function RecentMessages({ messages, loading = false, error = null }: RecentMessagesProps) {
  const recent = useMemo(
    () =>
      [...messages]
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        )
        .slice(0, 10),
    [messages],
  );

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Message Activity</CardTitle>
          <CardDescription>Latest WhatsApp dispatch outcomes across all channels</CardDescription>
        </div>
        <Link
          href="/messages"
          className="text-sm font-semibold text-[#007BC9] hover:text-blue-700 flex items-center gap-1 transition-colors"
        >
          View All Messages <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-slate-100 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-slate-100 animate-pulse rounded-md w-1/3" />
                  <div className="h-3 bg-slate-100 animate-pulse rounded-md w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-5">
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-800">
                <span className="font-semibold block mb-0.5">Message activity unavailable</span>
                {error}
              </div>
            </div>
          </div>
        ) : recent.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={MessageSquare}
              title="No message activity yet"
              description="Sent messages will appear here as your campaigns and direct sends run."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((msg) => (
              <li
                key={msg.id}
                className="flex items-start gap-3 px-4 sm:px-5 py-3.5 hover:bg-blue-50/40 transition-colors"
              >
                <div className="h-9 w-9 rounded-full bg-[#007BC9] text-white flex items-center justify-center text-xs font-bold shrink-0 border border-blue-700">
                  {initials(msg.customerName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-[#212529] truncate block">
                        {msg.customerName || 'Unknown customer'}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {maskMobile(msg.mobile)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={msg.status} />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500 font-mono truncate max-w-[240px]">
                      {msg.content || '—'}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono shrink-0">
                      {formatTimestamp(msg.createdAt)}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {msg.campaignId ? (
                      <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 font-mono">
                        Campaign {msg.campaignId.slice(0, 8)}...
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                        Direct Send
                      </span>
                    )}
                    {msg.whatsappId && (
                      <span className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                        WA ID: {msg.whatsappId}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}