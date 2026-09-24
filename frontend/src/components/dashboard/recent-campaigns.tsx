'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CampaignSummary } from '@/lib/api';
import { StatusBadge } from '../ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Send, ArrowUpRight, PlusCircle, AlertCircle } from 'lucide-react';

interface RecentCampaignsProps {
  campaigns: CampaignSummary[];
  loading?: boolean;
  error?: string | null;
}

export function RecentCampaigns({ campaigns, loading = false, error = null }: RecentCampaignsProps) {
  const router = useRouter();

  const recent = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 5),
    [campaigns],
  );

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Campaign Overview</CardTitle>
          <CardDescription>
            Most recent Bharat Gas broadcast campaigns, delivery statuses & progress
          </CardDescription>
        </div>
        <Link
          href="/campaigns"
          className="text-sm font-semibold text-[#007BC9] hover:text-blue-700 flex items-center gap-1 transition-colors"
        >
          View all campaigns <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-100 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-800">
                <span className="font-semibold block mb-0.5">Campaign data unavailable</span>
                {error}
              </div>
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Send}
              title="No broadcast campaigns created yet"
              description="Create and launch your first Bharat Gas WhatsApp broadcast for refill reminders or booking alerts."
              actionLabel="Create Campaign"
              actionIcon={PlusCircle}
              onAction={() => {
                router.push('/campaigns');
              }}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Campaign Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3 text-center">Total</th>
                  <th className="px-4 py-3 text-center text-emerald-700">Sent</th>
                  <th className="px-4 py-3 text-center text-amber-700">Pending</th>
                  <th className="px-4 py-3 text-center text-rose-700">Failed</th>
                  <th className="px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((camp) => {
                  const sent = camp.sent || 0;
                  const percent = camp.total > 0 ? Math.round((sent / camp.total) * 100) : 0;
                  return (
                    <tr key={camp.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-[#212529]">{camp.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                          ID: {camp.id}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={camp.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-20 sm:w-24 bg-slate-100 rounded-full overflow-hidden"
                            role="progressbar"
                            aria-label={`${camp.name}: ${percent}% complete`}
                            aria-valuenow={percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                percent >= 100
                                  ? 'bg-emerald-500'
                                  : camp.status === 'FAILED'
                                    ? 'bg-rose-500'
                                    : 'bg-[#007BC9]'
                              }`}
                              style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-slate-600 w-9 text-right">
                            {percent}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center font-medium text-slate-700">
                        {camp.total}
                      </td>
                      <td className="px-4 py-3.5 text-center font-semibold text-emerald-600">
                        {sent}
                      </td>
                      <td className="px-4 py-3.5 text-center font-semibold text-amber-600">
                        {camp.pending}
                      </td>
                      <td className="px-4 py-3.5 text-center font-semibold text-rose-600">
                        {camp.failed}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                        {formatDate(camp.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}