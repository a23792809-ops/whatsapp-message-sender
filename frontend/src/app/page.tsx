'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { StatCard } from '@/components/dashboard/stat-card';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { RecentCampaigns } from '@/components/dashboard/recent-campaigns';
import { SystemStatus } from '@/components/dashboard/system-status';
import {
  api,
  HealthResponse,
  WhatsAppStatusResponse,
  CampaignSummary,
} from '@/lib/api';
import {
  Users,
  Send,
  CheckCircle2,
  AlertOctagon,
  Clock,
  TrendingUp,
  AlertCircle,
  Flame,
} from 'lucide-react';

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatusResponse | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);

  const loadDashboardData = useCallback(async () => {
    try {
      const [healthData, waData, campaignsData] = await Promise.allSettled([
        api.health.check(),
        api.whatsapp.status(),
        api.campaigns.list(),
      ]);

      if (healthData.status === 'fulfilled') {
        setHealth(healthData.value);
      } else {
        console.warn('Health check failed:', healthData.reason);
      }

      if (waData.status === 'fulfilled') {
        setWhatsapp(waData.value);
      } else {
        console.warn('WhatsApp status check failed:', waData.reason);
      }

      if (campaignsData.status === 'fulfilled') {
        setCampaigns(campaignsData.value || []);
      } else {
        console.warn('Campaigns list check failed:', campaignsData.reason);
      }

      if (
        healthData.status === 'rejected' &&
        campaignsData.status === 'rejected' &&
        waData.status === 'rejected'
      ) {
        setError(
          'Unable to connect to the Bharat Gas messaging backend at localhost:3001. Ensure the NestJS server is running.'
        );
      } else {
        setError(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred while fetching dashboard metrics.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const fetchInitial = async () => {
      try {
        const [healthData, waData, campaignsData] = await Promise.allSettled([
          api.health.check(),
          api.whatsapp.status(),
          api.campaigns.list(),
        ]);

        if (ignore) return;

        if (healthData.status === 'fulfilled') setHealth(healthData.value);
        if (waData.status === 'fulfilled') setWhatsapp(waData.value);
        if (campaignsData.status === 'fulfilled') setCampaigns(campaignsData.value || []);

        if (
          healthData.status === 'rejected' &&
          campaignsData.status === 'rejected' &&
          waData.status === 'rejected'
        ) {
          setError(
            'Unable to connect to the Bharat Gas messaging backend at localhost:3001. Ensure the NestJS server is running.'
          );
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load initial data.');
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchInitial();

    return () => {
      ignore = true;
    };
  }, []);

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Metrics from backend data
  const totalCustomers = health?.database?.customers ?? 0;
  const activeCampaigns = campaigns.filter(
    (c) => c.status === 'RUNNING' || c.status === 'PAUSED' || c.status === 'QUEUED'
  ).length;

  const totalSent = campaigns.reduce((acc, c) => acc + (c.sent || 0), 0);
  const totalFailed = campaigns.reduce((acc, c) => acc + (c.failed || 0), 0);
  const totalPending = campaigns.reduce((acc, c) => acc + (c.pending || 0), 0);
  const processedMessages = totalSent + totalFailed;
  const successRate =
    processedMessages > 0
      ? `${Math.round((totalSent / processedMessages) * 100)}%`
      : '100%';

  const isBackendConnected = health?.status === 'ok';

  return (
    <AppShell
      isBackendConnected={isBackendConnected}
      onRefresh={handleManualRefresh}
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
              Manage your Bharat Gas customer communications, refill booking confirmations, KYC updates, and delivery broadcasts.
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
        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800">
              <span className="font-semibold block text-sm mb-0.5">Connection Notice:</span>
              {error}
            </div>
          </div>
        )}

        {/* Core Statistics Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Operational Delivery Metrics
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              Live Backend Synced
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 sm:gap-4">
            <StatCard
              title="Total Customers"
              value={totalCustomers.toLocaleString()}
              subtitle="Registered LPG Consumers"
              icon={Users}
              variant="default"
              loading={loading}
            />
            <StatCard
              title="Messages Sent"
              value={totalSent.toLocaleString()}
              subtitle="Delivered to WhatsApp"
              icon={CheckCircle2}
              variant="success"
              loading={loading}
            />
            <StatCard
              title="Pending Queue"
              value={totalPending.toLocaleString()}
              subtitle="Awaiting schedule / throttle"
              icon={Clock}
              variant="warning"
              loading={loading}
            />
            <StatCard
              title="Failed Messages"
              value={totalFailed.toLocaleString()}
              subtitle="Invalid number / missing vars"
              icon={AlertOctagon}
              variant="danger"
              loading={loading}
            />
            <StatCard
              title="Active Campaigns"
              value={activeCampaigns}
              subtitle={`${campaigns.length} total campaigns`}
              icon={Send}
              variant="orange"
              loading={loading}
            />
            <StatCard
              title="Delivery Rate"
              value={successRate}
              subtitle="Overall broadcast health"
              icon={TrendingUp}
              variant="success"
              loading={loading}
            />
          </div>
        </div>

        {/* Quick Actions & System Engine Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <QuickActions />
          </div>
          <div className="lg:col-span-1">
            <SystemStatus health={health} whatsapp={whatsapp} loading={loading} />
          </div>
        </div>

        {/* Recent Campaigns Table */}
        <div>
          <RecentCampaigns campaigns={campaigns} loading={loading} />
        </div>
      </div>
    </AppShell>
  );
}
