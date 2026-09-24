'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Wand2,
  RefreshCw,
  Copy,
  RotateCcw,
  Megaphone,
  User,
  FileText,
  ShieldAlert,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { api, ApiError, type AiDraftResponse, type CustomerSummary, type TemplateSummary } from '@/lib/api';

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto (default provider)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
] as const;

const TONE_OPTIONS = ['Professional', 'Friendly', 'Formal', 'Concise', 'Urgent', 'No specific tone'] as const;

function extractTemplateVariables(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

function serverMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const msg = (data as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg)) return msg.join(', ');
  }
  return undefined;
}

function mapAiError(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = serverMessage(err.data);
    if (err.status === 400) return detail || 'Please check the information provided.';
    if (err.status === 401 || err.status === 403) return 'AI access is not available.';
    if (err.status === 429) return 'Too many AI requests. Please try again shortly.';
    if (err.status === 503) return 'The AI service is not configured. Ask an administrator to set it up.';
    if (err.status >= 500) return 'The AI service could not generate a draft.';
    return detail || 'Please check the information provided.';
  }
  if (err instanceof Error) {
    if (/failed to fetch|networkerror|load failed|backend server/i.test(err.message)) {
      return 'Network request failed. Is the backend server running?';
    }
    return err.message;
  }
  return 'The AI service could not generate a draft.';
}

export default function AiAssistantPage() {
  const [provider, setProvider] = useState<'auto' | 'openai' | 'deepseek'>('auto');
  const [action, setAction] = useState<'generate' | 'improve'>('generate');
  const [tone, setTone] = useState<string>(TONE_OPTIONS[0]);
  const [instructions, setInstructions] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [existingMessage, setExistingMessage] = useState('');

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [editedDraft, setEditedDraft] = useState('');
  const [lastResult, setLastResult] = useState<{ provider: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedToCampaign, setCopiedToCampaign] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === customerId) || null;
  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  const customerVariables = useMemo(() => {
    const vars: Record<string, string> = {};
    if (!selectedCustomer) return vars;
    if (selectedCustomer.name) vars['customer_name'] = selectedCustomer.name;
    if (selectedCustomer.mobile) {
      vars['mobile'] = selectedCustomer.mobile;
      vars['mobile_no'] = selectedCustomer.mobile;
    }
    if (selectedCustomer.variables) {
      try {
        const parsed: unknown = JSON.parse(selectedCustomer.variables);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (value !== null && value !== undefined) vars[key] = String(value);
          }
        }
      } catch {
        // Non-JSON variables string is ignored safely.
      }
    }
    return vars;
  }, [selectedCustomer]);

  const templateVariables = useMemo(() => {
    if (!selectedTemplate) return [];
    return extractTemplateVariables(selectedTemplate.body);
  }, [selectedTemplate]);

  const providerPayload = provider === 'auto' ? undefined : provider;

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const [cust, tpl] = await Promise.all([
          api.customers.list({ pageSize: 200 }),
          api.templates.list(),
        ]);
        if (ignore) return;
        setCustomers(cust.data);
        setTemplates(tpl);
        setDataError(null);
      } catch (err: unknown) {
        if (!ignore) {
          setDataError(err instanceof Error ? err.message : 'Failed to load customer and template data.');
        }
      } finally {
        if (!ignore) setDataLoading(false);
      }
    };

    void loadInitial();
    return () => {
      ignore = true;
    };
  }, []);

  const applyDraft = useCallback((res: AiDraftResponse) => {
    setDraft(res.draft);
    setEditedDraft(res.draft);
    setLastResult({ provider: res.provider, model: res.model });
  }, []);

  const runDraft = useCallback(
    async (regenerate: boolean) => {
      setError(null);
      setCopied(false);
      setCopiedToCampaign(false);

      if (action === 'generate') {
        if (!templateId) {
          setError('Please select a template to generate from.');
          return;
        }
        if (!customerId) {
          setError('Please select a customer to personalize for.');
          return;
        }
        if (Object.keys(customerVariables).length === 0) {
          setError('Selected customer has no personalization variables.');
          return;
        }
        setBusy(true);
        setBusyLabel(regenerate ? 'Regenerating your draft...' : 'Generating your draft...');
        try {
          const res = await api.ai.generate({
            provider: providerPayload,
            template: selectedTemplate!.body,
            customer: customerVariables,
            instructions: instructions.trim() || undefined,
            tone: tone === 'No specific tone' ? undefined : tone.toLowerCase(),
          });
          applyDraft(res);
        } catch (err) {
          setError(mapAiError(err));
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!existingMessage.trim()) {
        setError('Please enter the existing message to improve.');
        return;
      }
      setBusy(true);
      setBusyLabel(regenerate ? 'Regenerating your draft...' : 'Improving your draft...');
      try {
        const res = await api.ai.improve({
          provider: providerPayload,
          message: existingMessage.trim(),
          instructions: instructions.trim() || undefined,
          tone: tone === 'No specific tone' ? undefined : tone.toLowerCase(),
        });
        applyDraft(res);
      } catch (err) {
        setError(mapAiError(err));
      } finally {
        setBusy(false);
      }
    },
    [action, templateId, customerId, customerVariables, instructions, tone, providerPayload, existingMessage, selectedTemplate, applyDraft],
  );

  const handleGenerate = useCallback(() => {
    void runDraft(false);
  }, [runDraft]);

  const handleRegenerate = useCallback(() => {
    void runDraft(true);
  }, [runDraft]);

  const handleImproveDraft = useCallback(async () => {
    if (!editedDraft.trim()) return;
    setError(null);
    setCopied(false);
    setCopiedToCampaign(false);
    setBusy(true);
    setBusyLabel('Improving your draft...');
    try {
      const res = await api.ai.improve({
        provider: providerPayload,
        message: editedDraft.trim(),
        instructions: instructions.trim() || undefined,
        tone: tone === 'No specific tone' ? undefined : tone.toLowerCase(),
      });
      applyDraft(res);
    } catch (err) {
      setError(mapAiError(err));
    } finally {
      setBusy(false);
    }
  }, [editedDraft, instructions, tone, providerPayload, applyDraft]);

  const handleCopy = useCallback(async () => {
    if (!editedDraft) return;
    try {
      await navigator.clipboard.writeText(editedDraft);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = editedDraft;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [editedDraft]);

  const handleUseInCampaign = useCallback(async () => {
    if (!editedDraft) return;
    try {
      await navigator.clipboard.writeText(editedDraft);
    } catch {
      // Clipboard may be unavailable; confirmation still guides the user to copy manually.
    }
    setCopiedToCampaign(true);
  }, [editedDraft]);

  const resetDraft = useCallback(() => {
    if (draft !== null) setEditedDraft(draft);
  }, [draft]);

  const isDirty = draft !== null && editedDraft !== draft;

  return (
    <AppShell>
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#007BC9] bg-blue-50 border border-blue-100 rounded-full px-3 py-1 uppercase tracking-wider">
          <Sparkles className="h-3.5 w-3.5" />
          AI-Powered Assistant
        </span>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-3">
          AI Message Assistant
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
          Draft and improve personalized WhatsApp messages for your customers with AI assistance.
          Every AI draft requires human review before it can be used in any campaign.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Configuration Panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>AI Configuration</CardTitle>
            <CardDescription>
              Choose how the AI should draft or improve your message.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {dataError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800">
                  <span className="font-semibold block">Could not load data:</span>
                  {dataError}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">AI Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                aria-label="AI provider"
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Action</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAction('generate')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                    action === 'generate'
                      ? 'bg-white shadow-sm text-[#007BC9]'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() => setAction('improve')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                    action === 'improve'
                      ? 'bg-white shadow-sm text-[#007BC9]'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Improve
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {action === 'generate'
                  ? 'Generate a new message from a template, personalized for one customer.'
                  : 'Rewrite an existing message to be clearer or more effective.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                aria-label="Tone"
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Instructions <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="e.g. Mention today's cylinder refill price, keep it under 160 characters and include a friendly greeting..."
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder-slate-400"
              />
            </div>

            {action === 'generate' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Customer</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500 pointer-events-none" />
                    <select
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      disabled={dataLoading}
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
                      aria-label="Select customer"
                    >
                      <option value="">{dataLoading ? 'Loading customers...' : 'Select a customer...'}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.mobile}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedCustomer && (
                    <div className="mt-2.5 p-3 rounded-lg bg-blue-50/60 border border-blue-100 space-y-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="h-4 w-4 text-[#007BC9] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#212529] truncate">
                            {selectedCustomer.name}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">{selectedCustomer.mobile}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                          Available variables
                        </div>
                        {Object.keys(customerVariables).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.keys(customerVariables).map((key) => (
                              <Badge key={key} variant="primary" size="sm">
                                {'{{' + key + '}}'}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No personalization variables.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Template <span className="font-normal text-slate-400">(base message)</span>
                  </label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500 pointer-events-none" />
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      disabled={dataLoading}
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
                      aria-label="Select template"
                    >
                      <option value="">{dataLoading ? 'Loading templates...' : 'Select a template...'}</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedTemplate && (
                    <div className="mt-2.5 p-3 rounded-lg bg-white border border-slate-200 space-y-2">
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                        {selectedTemplate.body}
                      </p>
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                          Template variables
                        </div>
                        {templateVariables.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {templateVariables.map((key) => (
                              <Badge key={key} variant="neutral" size="sm">
                                {'{{' + key + '}}'}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No placeholders in this template.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {action === 'improve' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Existing Message
                </label>
                <textarea
                  value={existingMessage}
                  onChange={(e) => setExistingMessage(e.target.value)}
                  maxLength={8000}
                  rows={6}
                  placeholder="Paste the message you want the AI to improve..."
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder-slate-400"
                />
                <div className="text-right text-[11px] text-slate-400 mt-1">
                  {existingMessage.length} / 8000 characters
                </div>
              </div>
            )}
          </CardContent>
          {action === 'generate' && (
            <CardFooter>
              <button
                onClick={handleGenerate}
                disabled={busy || dataLoading}
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-[#007BC9] hover:bg-blue-700 text-white text-sm font-semibold shadow-xs hover:shadow transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Generate Draft
                  </>
                )}
              </button>
            </CardFooter>
          )}
        </Card>

        {/* Draft Panel */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>AI Draft</CardTitle>
                <CardDescription>
                  Review and edit your draft before using it. Nothing is ever sent automatically.
                </CardDescription>
              </div>
              {lastResult && (
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <Badge variant="primary">Provider: {lastResult.provider}</Badge>
                  <Badge variant="neutral">Model: {lastResult.model}</Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 mb-4">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-800">{error}</p>
              </div>
            )}

            {busy ? (
              <div className="p-8 space-y-4">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <Loader2 className="h-5 w-5 text-[#007BC9] animate-spin" />
                  <span className="font-medium">{busyLabel}</span>
                </div>
                <div className="h-4 bg-slate-100 animate-pulse rounded-md w-3/4" />
                <div className="h-4 bg-slate-100 animate-pulse rounded-md w-full" />
                <div className="h-4 bg-slate-100 animate-pulse rounded-md w-5/6" />
                <div className="h-4 bg-slate-100 animate-pulse rounded-md w-2/3" />
              </div>
            ) : draft === null ? (
              <EmptyState
                icon={Sparkles}
                title="Your AI-generated message will appear here."
                description="Configure the settings on the left and click Generate Draft. Every AI draft requires human review before use."
              />
            ) : (
              <>
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 mb-4">
                  <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Review required</p>
                    <p className="text-xs text-amber-700">
                      AI-generated messages are drafts. Review and edit the message before using it in
                      a campaign. Human review required before sending.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all overflow-hidden">
                  <textarea
                    value={editedDraft}
                    onChange={(e) => {
                      setEditedDraft(e.target.value);
                      setCopied(false);
                      setCopiedToCampaign(false);
                    }}
                    maxLength={8000}
                    rows={12}
                    aria-label="Editable AI draft"
                    className="w-full p-4 text-sm bg-white text-slate-800 resize-y focus:outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-200">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {editedDraft.length} / 8000 characters
                    </span>
                    {isDirty && (
                      <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" /> Edited draft — re-review before use
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 mt-4">
                  <button
                    onClick={handleRegenerate}
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate
                  </button>
                  <button
                    onClick={handleImproveDraft}
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                    title="Improve the current draft further"
                  >
                    <Sparkles className="h-4 w-4 text-[#007BC9]" />
                    Improve Draft
                  </button>
                  <button
                    onClick={() => void handleCopy()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                  >
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  {isDirty && (
                    <button
                      onClick={resetDraft}
                      disabled={busy}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                      title="Revert to the AI-generated draft"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </button>
                  )}
                </div>

                <div className="mt-5 pt-4 border-t border-slate-200">
                  <button
                    onClick={() => void handleUseInCampaign()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#007BC9] hover:bg-blue-700 text-white text-sm font-semibold shadow-xs hover:shadow transition-all duration-150 disabled:opacity-50"
                  >
                    <Megaphone className="h-4 w-4" />
                    Copy to Campaign
                  </button>
                  {copiedToCampaign && (
                    <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <p className="text-xs text-slate-700">
                        Draft copied to clipboard. Paste it into a message template, then create your
                        campaign. Nothing was sent.
                      </p>
                      <Link
                        href="/campaigns"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#007BC9] hover:underline"
                      >
                        Open Campaigns <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}