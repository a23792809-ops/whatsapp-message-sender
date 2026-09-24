'use client';

import React, { useMemo } from 'react';
import { CampaignSummary } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Send, Activity, AlertCircle } from 'lucide-react';

interface CampaignHealthProps {
  campaigns: CampaignSummary[];
  loading?: boolean;
  error?: string | null;
}

const STATUS_ORDER = ['RUNNING', 'QUEUED', 'PAUSED', 'COMPLETED', 'FAILED', 'DRAFT', 'STOPPED'] as const;

const STATUS_META: Record<string, { label: string; bar: string; dot: string }> = {
  RUNNING: { label: 'Running', bar: 'bg-[#007BC9]', dot: 'bg-[#007BC9]' },
  QUEUED: { label: 'Queued', bar: 'bg-sky-400', dot: 'bg-sky-400' },
  PAUSED: { label: 'Paused', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  COMPLETED: { label: 'Completed', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  FAILED: { label: 'Failed', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  DRAFT: { label: 'Draft', bar: 'bg-slate-400', dot: 'bg-slate-400' },
  STOPPED: { label: 'Stopped', bar: 'bg-slate-500', dot: 'bg-slate-500' },
};

export function CampaignHealth({ campaigns, loading = false, error = null }: CampaignHealthProps) {
  const buckets = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const camp of campaigns) {
      const status = (camp.status || 'DRAFT').toUpperCase();
      counts[status] = (counts[status] || 0) + 1;
    }
    return STATUS_ORDER.map((status) => ({ status, count: counts[status] || 0 })).filter(
      (row) => row.count > 0,
    );
  }, [campaigns]);

  const total = campaigns.length;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#007BC9]" />
          Campaign Health
        </CardTitle>
        <CardDescription>Distribution of campaign states across the agency</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-4 bg-slate-100 animate-pulse rounded-md" />
                <div className="h-2.5 bg-slate-100 animate-pulse rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800">
              <span className="font-semibold block mb-0.5">Campaign data unavailable</span>
              {error}
            </div>
          </div>
        ) : total === 0 ? (
          <div className="p-2">
            <EmptyState
              icon={Send}
              title="No campaign activity yet"
              description="Launch a campaign to see its live health distribution here."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {buckets.map((row) => {
              const meta = STATUS_META[row.status] || STATUS_META.DRAFT;
              const percent = total > 0 ? Math.round((row.count / total) * 100) : 0;
              return (
                <div key={row.status}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {row.count} · {percent}%
                    </span>
                  </div>
                  <div
                    className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-label={`${meta.label}: ${row.count} campaigns (${percent}%)`}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={`h-full ${meta.bar} rounded-full transition-all duration-500`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}