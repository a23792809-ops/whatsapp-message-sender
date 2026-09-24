'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { StatCard } from '@/components/dashboard/stat-card';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { RecentCampaigns } from '@/components/dashboard/recent-campaigns';
import { CampaignHealth } from '@/components/dashboard/campaign-health';
import { RecentMessages } from '@/components/dashboard/recent-messages';
import { SystemStatus } from '@/components/dashboard/system-status';
import {
  api,
  HealthResponse,
  WhatsAppStatusResponse,
  CampaignSummary,
  MessageSummary,
} from '@/lib/api';
import {
  Users,
  Send,
  CheckCircle2,
  AlertOctagon,
  Clock,
  Flame,
  AlertCircle,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface DashboardSettled {
  health: PromiseSettledResult<HealthResponse>;
  campaigns: PromiseSettledResult<CampaignSummary[]>;
  messages: PromiseSettledResult<MessageSummary[]>;
  whatsapp: PromiseSettledResult<WhatsAppStatusResponse>;
}

async function fetchDashboardAll(): Promise<DashboardSettled> {
  const [health, campaigns, messages, whatsapp] = await Promise.allSettled([
    api.health.check(),
    api.campaigns.list(),
    api.messages.list(),
    api.whatsapp.status(),
  ]);
  return { health, campaigns, messages, whatsapp };
}

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatusResponse | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [messages, setMessages] = useState<MessageSummary[]>([]);

  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [campaignCount, setCampaignCount] = useState<number | null>(null);
  const [totals, setTotals] = useState({ sent: 0, pending: 0, failed: 0 });

  const [healthError, setHealthError] = useState<string | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);

  const applyResults = useCallback((res: DashboardSettled, isInitial: boolean) => {
    if (res.health.status === 'fulfilled') {
      setHealth(res.health.value);
      setHealthError(null);
      if (res.health.value.database) {
        setCustomerCount(res.health.value.database.customers ?? 0);
      }
    } else if (isInitial) {
      setHealthError('Unable to load customer data.');
    }

    if (res.campaigns.status === 'fulfilled') {
      const list = res.campaigns.value || [];
      setCampaigns(list);
      setCampaignsError(null);
      setCampaignCount(list.length);
      setTotals({
        sent: list.reduce((acc, c) => acc + (c.sent || 0), 0),
        pending: list.reduce((acc, c) => acc + (c.pending || 0), 0),
        failed: list.reduce((acc, c) => acc + (c.failed || 0), 0),
      });
    } else if (isInitial) {
      setCampaignsError('Unable to load campaign data.');
      if (res.health.status === 'fulfilled') {
        setCampaignCount(res.health.value.database?.campaigns ?? 0);
      }
    }

    if (res.messages.status === 'fulfilled') {
      setMessages(res.messages.value || []);
      setMessagesError(null);
    } else if (isInitial) {
      setMessagesError('Unable to load message activity.');
    }

    if (res.whatsapp.status === 'fulfilled') {
      setWhatsapp(res.whatsapp.value);
      setWaError(null);
    } else if (isInitial) {
      setWaError('Unable to verify WhatsApp status.');
    }

    if (isInitial) {
      const allFailed =
        res.health.status === 'rejected' &&
        res.campaigns.status === 'rejected' &&
        res.messages.status === 'rejected' &&
        res.whatsapp.status === 'rejected';
      setConnectionError(
        allFailed
          ? 'Unable to connect to the Bharat Gas messaging backend at localhost:3001. Ensure the NestJS server is running, then press Refresh.'
          : null,
      );
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      const res = await fetchDashboardAll();
      if (ignore) return;
      applyResults(res, true);
      setLoading(false);
    };

    void loadInitial();
    return () => {
      ignore = true;
    };
  }, [applyResults]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetchDashboardAll();
      applyResults(res, false);
    } finally {
      setRefreshing(false);
    }
  }, [applyResults]);

  const isBackendConnected = health?.status === 'ok';
  const busy = loading || refreshing;

  return (
    <AppShell
      isBackendConnected={isBackendConnected}
      onRefresh={() => {
        void handleRefresh();
      }}
      isRefreshing={refreshing}
    >
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-[#007BC9] to-[#0066A8] rounded-2xl p-6 sm:p-8 text-white shadow-md border border-blue-700/40 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-[#FFDC02] text-[#00304A] border border-yellow-300 text-xs font-bold uppercase tracking-wider">
                Agency Operations Desk
              </span>
              <span className="text-sm text-blue-100">Alibag LPG Distribution Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>{getGreeting()}, Operator</span>
              <Flame className="h-6 w-6 text-[#FFDC02]" />
            </h1>
            <p className="text-sm sm:text-base text-blue-100 max-w-2xl leading-relaxed">
              Manage your Bharat Gas customer communications, refill booking confirmations, KYC
              updates, and delivery broadcasts.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10 self-start md:self-auto">
            <div className="text-right">
              <div className="text-xs text-blue-100 uppercase font-semibold">Delivery Channel</div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5 justify-end">
                <span className="h-2 w-2 rounded-full bg-[#FFDC02] animate-pulse" />
                Meta WhatsApp Business
              </div>
            </div>
          </div>
        </div>

        {/* Global Connection Alert Banner */}
        {connectionError && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800">
              <span className="font-semibold block text-sm mb-0.5">Connection Notice:</span>
              {connectionError}
            </div>
          </div>
        )}

        {/* KPI Section */}
        <div>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Operational Delivery Metrics
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live figures from your Bharat Gas messaging backend
              </p>
            </div>
            <button
              onClick={() => void handleRefresh()}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-xs font-semibold shadow-xs transition-all active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="Refresh dashboard data"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#007BC9]" />
              ) : (
                <RefreshCw className={`h-4 w-4 text-[#007BC9] ${loading ? 'animate-spin' : ''}`} />
              )}
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-4">
            <StatCard
              title="Total Customers"
              value={customerCount !== null ? customerCount.toLocaleString() : 0}
              subtitle="All imported consumers"
              icon={Users}
              variant="default"
              loading={loading}
              error={healthError !== null}
            />
            <StatCard
              title="Total Campaigns"
              value={campaignCount !== null ? campaignCount.toLocaleString() : 0}
              subtitle="All broadcast campaigns"
              icon={Send}
              variant="orange"
              loading={loading}
              error={campaignsError !== null && campaignCount === null}
            />
            <StatCard
              title="Messages Sent"
              value={totals.sent.toLocaleString()}
              subtitle="Delivered to WhatsApp"
              icon={CheckCircle2}
              variant="success"
              loading={loading}
              error={campaignsError !== null}
            />
            <StatCard
              title="Messages Pending"
              value={totals.pending.toLocaleString()}
              subtitle="Awaiting schedule / throttle"
              icon={Clock}
              variant="warning"
              loading={loading}
              error={campaignsError !== null}
            />
            <StatCard
              title="Messages Failed"
              value={totals.failed.toLocaleString()}
              subtitle="Invalid number / delivery error"
              icon={AlertOctagon}
              variant="danger"
              loading={loading}
              error={campaignsError !== null}
            />
          </div>
        </div>

        {/* Campaign Overview */}
        <RecentCampaigns campaigns={campaigns} loading={loading} error={campaignsError} />

        {/* Campaign Health + Recent Message Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-1">
            <CampaignHealth campaigns={campaigns} loading={loading} error={campaignsError} />
          </div>
          <div className="lg:col-span-2">
            <RecentMessages messages={messages} loading={loading} error={messagesError} />
          </div>
        </div>

        {/* Quick Actions & System Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2">
            <QuickActions />
          </div>
          <div className="lg:col-span-1">
            <SystemStatus
              health={health}
              whatsapp={whatsapp}
              loading={loading}
              waError={waError}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}