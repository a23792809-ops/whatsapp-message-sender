'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import {
  api,
  CampaignSummary,
  CustomerSummary,
  TemplateSummary,
  CampaignProgressResponse,
} from '@/lib/api';
import {
  Send,
  PlusCircle,
  Play,
  Pause,
  RotateCw,
  Ban,
  Clock,
  CheckCircle2,
  Search,
  CheckSquare,
  AlertCircle,
  Flame,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  Eye,
  Sliders,
  FileText,
} from 'lucide-react';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active Campaign Monitor Modal
  const [monitoredCampaignId, setMonitoredCampaignId] = useState<string | null>(null);
  const [monitorProgress, setMonitorProgress] = useState<CampaignProgressResponse | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Create Campaign Wizard State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Wizard Form Fields
  const [campaignName, setCampaignName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [throttleSeconds, setThrottleSeconds] = useState<number>(19); // 19 seconds safe default
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Customer Selection Filtering in Wizard
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerFilterStatus] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    try {
      const [campRes, tplRes, custRes] = await Promise.allSettled([
        api.campaigns.list(),
        api.templates.list(),
        api.customers.list(),
      ]);

      if (campRes.status === 'fulfilled') {
        setCampaigns(campRes.value || []);
      }
      if (tplRes.status === 'fulfilled') {
        setTemplates(tplRes.value || []);
      }
      if (custRes.status === 'fulfilled') {
        setCustomers(custRes.value?.data || []);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const [campRes, tplRes, custRes] = await Promise.allSettled([
          api.campaigns.list(),
          api.templates.list(),
          api.customers.list(),
        ]);

        if (ignore) return;

        if (campRes.status === 'fulfilled') {
          setCampaigns(campRes.value || []);
        }
        if (tplRes.status === 'fulfilled') {
          setTemplates(tplRes.value || []);
        }
        if (custRes.status === 'fulfilled') {
          setCustomers(custRes.value?.data || []);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to fetch campaigns data.');
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

  // Live polling for monitored campaign
  useEffect(() => {
    if (!monitoredCampaignId) return;

    const pollProgress = async () => {
      try {
        const p = await api.campaigns.progress(monitoredCampaignId);
        setMonitorProgress(p);
        const cList = await api.campaigns.list();
        setCampaigns(cList || []);
      } catch (err) {
        console.warn('Progress poll failed:', err);
      }
    };

    pollProgress();
    const intervalId = setInterval(pollProgress, 2500);

    return () => {
      clearInterval(intervalId);
    };
  }, [monitoredCampaignId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Open Wizard
  const handleOpenWizard = () => {
    setCurrentStep(1);
    setCampaignName(`Bharat Gas Broadcast - ${new Date().toLocaleDateString('en-GB')}`);
    setSelectedTemplateId(templates.length > 0 ? templates[0].id : '');
    setSelectedCustomerIds(customers.map((c) => c.id)); // select all by default
    setThrottleSeconds(19);
    setWizardError(null);
    setWizardOpen(true);
  };

  // Customer filter inside wizard
  const wizardFilteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch =
        customerSearch === '' ||
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.mobile.includes(customerSearch);
      const matchStatus =
        customerFilterStatus === 'ALL' ||
        (customerFilterStatus === 'SENT' && (c.status === 'SENT' || c.status === 'COMPLETED')) ||
        (customerFilterStatus === 'PENDING' && (c.status === 'PENDING' || !c.status)) ||
        (customerFilterStatus === 'FAILED' && c.status === 'FAILED');
      return matchSearch && matchStatus;
    });
  }, [customers, customerSearch, customerFilterStatus]);

  // Toggle Single Customer Selection
  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Toggle Select All Filtered Customers
  const toggleSelectAllFiltered = () => {
    const filteredIds = wizardFilteredCustomers.map((c) => c.id);
    const allSelected = filteredIds.every((id) => selectedCustomerIds.includes(id));
    if (allSelected) {
      setSelectedCustomerIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedCustomerIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  // Submit and Launch Campaign
  const handleCreateAndStartCampaign = async (autoStart: boolean) => {
    if (!campaignName.trim()) {
      setWizardError('Please provide a campaign name.');
      return;
    }
    if (!selectedTemplateId) {
      setWizardError('Please select a message template.');
      return;
    }
    if (selectedCustomerIds.length === 0) {
      setWizardError('Please select at least one customer.');
      return;
    }

    try {
      setCreatingCampaign(true);
      setWizardError(null);

      const created = await api.campaigns.create({
        name: campaignName.trim(),
        templateId: selectedTemplateId,
        customerIds: selectedCustomerIds,
        throttleMs: Math.max(5000, throttleSeconds * 1000),
      });

      if (autoStart && created.id) {
        await api.campaigns.start(created.id);
      }

      setWizardOpen(false);
      await fetchData();

      if (created.id) {
        setMonitoredCampaignId(created.id);
      }
    } catch (err: unknown) {
      setWizardError(err instanceof Error ? err.message : 'Failed to create campaign.');
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Campaign Controls
  const handleCampaignAction = async (id: string, action: 'start' | 'pause' | 'resume' | 'stop' | 'retry') => {
    try {
      setActionLoading(true);
      if (action === 'start') await api.campaigns.start(id);
      if (action === 'pause') await api.campaigns.pause(id);
      if (action === 'resume') await api.campaigns.resume(id);
      if (action === 'stop') await api.campaigns.stop(id);
      if (action === 'retry') await api.campaigns.retry(id);

      const p = await api.campaigns.progress(id);
      setMonitorProgress(p);
      const cList = await api.campaigns.list();
      setCampaigns(cList || []);
    } catch (err: unknown) {
      alert(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const monitoredCampaign = campaigns.find((c) => c.id === monitoredCampaignId);

  return (
    <AppShell onRefresh={handleRefresh} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider">
                LPG Broadcast Management
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              Campaigns & Refill Broadcasts
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Launch and supervise throttled WhatsApp broadcast campaigns with live delivery progress and retry controls.
            </p>
          </div>

          <button
            onClick={handleOpenWizard}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs hover:shadow transition-all active:scale-98 self-start sm:self-auto"
          >
            <PlusCircle className="h-4 w-4" />
            + Create New Campaign
          </button>
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

        {/* Active Campaigns Table & Live Monitoring */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Broadcast Campaigns</CardTitle>
                <CardDescription>Track status, delivery speed, pending messages and operational controls</CardDescription>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                Total: <strong>{campaigns.length}</strong>
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-slate-100 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Send}
                  title="No broadcast campaigns created yet"
                  description="Create a campaign to begin sending personalized customer messages."
                  actionLabel="Create Campaign"
                  actionIcon={PlusCircle}
                  onAction={handleOpenWizard}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3.5">Campaign Name</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5 text-center">Progress</th>
                      <th className="px-4 py-3.5 text-center">Total</th>
                      <th className="px-4 py-3.5 text-center text-emerald-700">Sent</th>
                      <th className="px-4 py-3.5 text-center text-rose-700">Failed</th>
                      <th className="px-4 py-3.5 text-center text-amber-700">Pending</th>
                      <th className="px-4 py-3.5">Throttle</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {campaigns.map((camp) => {
                      const processed = (camp.sent || 0) + (camp.failed || 0);
                      const percent = camp.total > 0 ? Math.round((processed / camp.total) * 100) : 0;
                      const isRunning = camp.status === 'RUNNING';
                      const isPaused = camp.status === 'PAUSED';
                      const isDraft = camp.status === 'DRAFT' || camp.status === 'QUEUED';

                      return (
                        <tr key={camp.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-900">{camp.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">ID: {camp.id}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={camp.status} />
                          </td>
                          <td className="px-4 py-3.5 min-w-[140px]">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                                <span>{percent}%</span>
                                <span>{processed} / {camp.total}</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-center font-bold text-slate-800">
                            {camp.total}
                          </td>
                          <td className="px-4 py-3.5 text-center font-bold text-emerald-600">
                            {camp.sent}
                          </td>
                          <td className="px-4 py-3.5 text-center font-bold text-rose-600">
                            {camp.failed}
                          </td>
                          <td className="px-4 py-3.5 text-center font-bold text-amber-600">
                            {camp.pending}
                          </td>
                          <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3 text-slate-400" />
                              {(camp.throttleMs / 1000).toFixed(0)}s delay
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Open Monitor Drawer Button */}
                              <button
                                onClick={() => setMonitoredCampaignId(camp.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-orange-600 bg-white hover:bg-orange-50 border border-slate-200 hover:border-orange-200 rounded-md transition-all shadow-2xs"
                                title="Monitor & Controls"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Monitor</span>
                              </button>

                              {/* Direct Action Buttons */}
                              {isDraft && (
                                <button
                                  onClick={() => handleCampaignAction(camp.id, 'start')}
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md transition-colors"
                                  title="Start Campaign"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {isRunning && (
                                <button
                                  onClick={() => handleCampaignAction(camp.id, 'pause')}
                                  className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-md transition-colors"
                                  title="Pause Campaign"
                                >
                                  <Pause className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {isPaused && (
                                <button
                                  onClick={() => handleCampaignAction(camp.id, 'resume')}
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md transition-colors"
                                  title="Resume Campaign"
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {(isRunning || isPaused) && (
                                <button
                                  onClick={() => handleCampaignAction(camp.id, 'stop')}
                                  className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md transition-colors"
                                  title="Stop Campaign"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {camp.failed > 0 && (
                                <button
                                  onClick={() => handleCampaignAction(camp.id, 'retry')}
                                  className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md transition-colors"
                                  title="Retry Failed Messages"
                                >
                                  <RotateCw className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
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

        {/* Step-by-Step Campaign Creation Wizard Modal */}
        <Modal
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          title="Create Bharat Gas WhatsApp Campaign"
          description={`Step ${currentStep} of 4: ${
            currentStep === 1
              ? 'Select Message Template'
              : currentStep === 2
              ? 'Select Customer Recipients'
              : currentStep === 3
              ? 'Configure Throttling & Review'
              : 'Launch Confirmation'
          }`}
          maxWidth="3xl"
        >
          <div className="space-y-5">
            {/* Step Indicators */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              {[
                { step: 1, label: 'Template' },
                { step: 2, label: 'Customers' },
                { step: 3, label: 'Throttle & Review' },
                { step: 4, label: 'Launch' },
              ].map((item) => (
                <div key={item.step} className="flex items-center gap-2">
                  <div
                    className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      currentStep === item.step
                        ? 'bg-orange-600 text-white ring-4 ring-orange-100'
                        : currentStep > item.step
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {currentStep > item.step ? '✓' : item.step}
                  </div>
                  <span
                    className={`text-xs font-semibold hidden sm:inline ${
                      currentStep === item.step ? 'text-orange-600' : 'text-slate-500'
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Error Banner */}
            {wizardError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>{wizardError}</div>
              </div>
            )}

            {/* STEP 1: SELECT TEMPLATE */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                    Campaign Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alibag Monthly Refill Broadcast"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Choose Message Template *
                  </label>
                  {templates.length === 0 ? (
                    <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 text-center">
                      <p className="text-xs text-slate-500 mb-2">No templates found in database.</p>
                      <Link
                        href="/templates"
                        onClick={() => setWizardOpen(false)}
                        className="text-xs font-bold text-orange-600 hover:underline inline-block"
                      >
                        Create a template first →
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                      {templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          onClick={() => setSelectedTemplateId(tpl.id)}
                          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                            selectedTemplateId === tpl.id
                              ? 'bg-orange-50/70 border-orange-500 ring-2 ring-orange-500/20 shadow-xs'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {tpl.name}
                            </span>
                            {selectedTemplateId === tpl.id && (
                              <CheckCircle2 className="h-4 w-4 text-orange-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                            {tpl.description || tpl.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedTemplate && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      Template Body Preview:
                    </span>
                    <p className="font-mono text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {selectedTemplate.body}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: SELECT CUSTOMERS */}
            {currentStep === 2 && (
              <div className="space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search customers by name or mobile..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 shadow-2xs"
                    >
                      <CheckSquare className="h-3.5 w-3.5 text-orange-600" />
                      Toggle All Filtered
                    </button>
                    <span className="text-xs font-bold text-slate-800 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg">
                      {selectedCustomerIds.length} Selected
                    </span>
                  </div>
                </div>

                {/* Customer Selection Table */}
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                  {customers.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No customers available. Please import customers from the Customers tab first.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="px-4 py-2 w-10">Select</th>
                          <th className="px-4 py-2">Customer Name</th>
                          <th className="px-4 py-2">Mobile</th>
                          <th className="px-4 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {wizardFilteredCustomers.map((c) => {
                          const isSelected = selectedCustomerIds.includes(c.id);
                          return (
                            <tr
                              key={c.id}
                              onClick={() => toggleCustomer(c.id)}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-orange-50/50 hover:bg-orange-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}} // handled by row click
                                  className="rounded text-orange-600 focus:ring-orange-500 h-4 w-4"
                                />
                              </td>
                              <td className="px-4 py-2 font-semibold text-slate-900">{c.name}</td>
                              <td className="px-4 py-2 font-mono text-slate-700">+91 {c.mobile}</td>
                              <td className="px-4 py-2">
                                <StatusBadge status={c.status || 'PENDING'} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* STEP 3: CONFIGURE THROTTLE & REVIEW MESSAGES */}
            {currentStep === 3 && (
              <div className="space-y-4">
                {/* Throttle Configuration Card */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-orange-600" />
                      WhatsApp Throttle Delay (Per Message)
                    </label>
                    <span className="font-mono text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded border border-orange-200">
                      {throttleSeconds} Seconds
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={throttleSeconds}
                    onChange={(e) => setThrottleSeconds(Number(e.target.value))}
                    className="w-full accent-orange-600"
                  />
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>5s (Minimum)</span>
                    <span className="text-emerald-700 font-semibold">19s (Safe Recommended)</span>
                    <span>60s (Slow)</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Throttle regulates the dispatch rate to ensure compliance with Meta WhatsApp Business Cloud rate limits and anti-spam filters.
                  </p>
                </div>

                {/* Personalized Message Samples */}
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-orange-600" />
                    Personalized Message Preview Sample (1st Selected Recipient):
                  </h4>
                  {selectedCustomerIds.length > 0 && selectedTemplate ? (
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-mono space-y-2">
                      <div className="text-[10px] text-slate-400 font-bold uppercase">
                        Recipient: {customers.find((c) => c.id === selectedCustomerIds[0])?.name || 'Customer'} (+91{' '}
                        {customers.find((c) => c.id === selectedCustomerIds[0])?.mobile || ''})
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-slate-200 whitespace-pre-wrap leading-relaxed text-slate-800">
                        {selectedTemplate.body.replace(
                          /\{\{\s*customer_name\s*\}\}/g,
                          customers.find((c) => c.id === selectedCustomerIds[0])?.name || 'Customer'
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">No template or recipient selected.</div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 4: LAUNCH CONFIRMATION CARD */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-gradient-to-br from-[#007BC9] to-[#0066A8] text-white border border-blue-700 shadow-md space-y-4">
                  <div className="flex items-center justify-between border-b border-blue-800/80 pb-3">
                    <div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 uppercase">
                        Broadcast Ready
                      </span>
                      <h3 className="text-base font-bold text-white mt-1">{campaignName}</h3>
                    </div>
                    <Flame className="h-6 w-6 text-orange-400" />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/10">
                      <div className="text-[10px] text-blue-200 uppercase font-semibold">Total Recipients</div>
                      <div className="text-lg font-bold text-white mt-0.5">{selectedCustomerIds.length}</div>
                    </div>
                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/10">
                      <div className="text-[10px] text-blue-200 uppercase font-semibold">Template</div>
                      <div className="text-xs font-bold text-white mt-1 truncate">{selectedTemplate?.name}</div>
                    </div>
                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/10">
                      <div className="text-[10px] text-blue-200 uppercase font-semibold">Throttle Interval</div>
                      <div className="text-lg font-bold text-white mt-0.5">{throttleSeconds}s</div>
                    </div>
                    <div className="p-2.5 bg-white/10 rounded-xl border border-white/10">
                      <div className="text-[10px] text-blue-200 uppercase font-semibold">Est. Total Time</div>
                      <div className="text-xs font-bold text-white mt-1 font-mono">
                        ~{Math.round((selectedCustomerIds.length * throttleSeconds) / 60)} mins
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Operational Compliance:</strong> Messages are sent via the Meta WhatsApp Cloud API with automatic variable substitution and live progress tracking.
                  </div>
                </div>
              </div>
            )}

            {/* Wizard Navigation Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3 | 4) : prev))}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setWizardOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )}

              <div className="flex items-center gap-2">
                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentStep === 1 && !selectedTemplateId) {
                        setWizardError('Please select a template.');
                        return;
                      }
                      if (currentStep === 2 && selectedCustomerIds.length === 0) {
                        setWizardError('Please select at least one customer.');
                        return;
                      }
                      setWizardError(null);
                      setCurrentStep((prev) => (prev < 4 ? ((prev + 1) as 1 | 2 | 3 | 4) : prev));
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
                  >
                    Next Step
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={creatingCampaign}
                      onClick={() => handleCreateAndStartCampaign(false)}
                      className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition-all"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="button"
                      disabled={creatingCampaign}
                      onClick={() => handleCreateAndStartCampaign(true)}
                      className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all active:scale-98"
                    >
                      {creatingCampaign ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Launching...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          Start Broadcast Now
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>

        {/* Live Campaign Monitoring & Control Drawer Modal */}
        <Modal
          isOpen={!!monitoredCampaignId}
          onClose={() => setMonitoredCampaignId(null)}
          title={
            monitoredCampaign ? `Monitor: ${monitoredCampaign.name}` : 'Live Campaign Monitor'
          }
          description="Real-time dispatch rate, WhatsApp delivery responses, queue counts and engine controls"
          maxWidth="2xl"
        >
          {monitoredCampaign && (
            <div className="space-y-4">
              {/* Top Status & Controls Strip */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2.5">
                  <StatusBadge status={monitorProgress?.status || monitoredCampaign.status} />
                  <span className="text-xs text-slate-500 font-mono">
                    ID: {monitoredCampaign.id}
                  </span>
                </div>

                {/* Control Actions */}
                <div className="flex items-center gap-2">
                  {(monitoredCampaign.status === 'DRAFT' || monitoredCampaign.status === 'QUEUED') && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleCampaignAction(monitoredCampaign.id, 'start')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      <Play className="h-3.5 w-3.5" /> Start
                    </button>
                  )}
                  {monitoredCampaign.status === 'RUNNING' && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleCampaignAction(monitoredCampaign.id, 'pause')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </button>
                  )}
                  {monitoredCampaign.status === 'PAUSED' && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleCampaignAction(monitoredCampaign.id, 'resume')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      <Play className="h-3.5 w-3.5" /> Resume
                    </button>
                  )}
                  {(monitoredCampaign.status === 'RUNNING' || monitoredCampaign.status === 'PAUSED') && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleCampaignAction(monitoredCampaign.id, 'stop')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      <Ban className="h-3.5 w-3.5" /> Stop
                    </button>
                  )}
                  {monitoredCampaign.failed > 0 && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleCampaignAction(monitoredCampaign.id, 'retry')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Retry Failed
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar & Percentage */}
              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>Broadcast Completion</span>
                  <span className="font-mono text-orange-600">
                    {monitorProgress?.percentage ??
                      (monitoredCampaign.total > 0
                        ? Math.round(
                            (((monitoredCampaign.sent || 0) + (monitoredCampaign.failed || 0)) /
                              monitoredCampaign.total) *
                              100
                          )
                        : 0)}
                    %
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
                  <div
                    className="bg-orange-500 h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        monitorProgress?.percentage ??
                        (monitoredCampaign.total > 0
                          ? Math.round(
                              (((monitoredCampaign.sent || 0) + (monitoredCampaign.failed || 0)) /
                                monitoredCampaign.total) *
                                100
                            )
                          : 0)
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Stat Boxes */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Total Messages</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">
                    {monitorProgress?.total ?? monitoredCampaign.total}
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase">Delivered (Sent)</div>
                  <div className="text-xl font-bold text-emerald-700 mt-1">
                    {monitorProgress?.sent ?? monitoredCampaign.sent}
                  </div>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-center">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">Pending Queue</div>
                  <div className="text-xl font-bold text-amber-700 mt-1">
                    {monitorProgress?.pending ?? monitoredCampaign.pending}
                  </div>
                </div>
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-center">
                  <div className="text-[10px] font-bold text-rose-700 uppercase">Failed / Blocked</div>
                  <div className="text-xl font-bold text-rose-700 mt-1">
                    {monitorProgress?.failed ?? monitoredCampaign.failed}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setMonitoredCampaignId(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close Monitor
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}
