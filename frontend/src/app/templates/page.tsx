'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import {
  api,
  TemplateSummary,
  CustomerSummary,
  TemplatePreviewResponse,
} from '@/lib/api';
import {
  FileText,
  PlusCircle,
  Eye,
  Edit,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Tag,
} from 'lucide-react';

const PRESET_BHARAT_TEMPLATES = [
  {
    name: 'Bharat Gas - Refill Booking Confirmation',
    description: 'Sent immediately when a consumer books an LPG cylinder refill',
    body: `Dear {{customer_name}},

Your Bharat Gas LPG cylinder booking has been confirmed!

Booking Reference: {{booking_no}}
Consumer ID: {{consumer_no}}
Agency: Alibag Bharat Gas Agency
Estimated Delivery: 24-48 Hours

To track your refill or report gas leakage, dial emergency 1906.
Thank you for choosing Bharat Gas.`,
  },
  {
    name: 'Bharat Gas - Cylinder Out for Delivery',
    description: 'Notifies customer when the LPG delivery executive is dispatched',
    body: `Dear {{customer_name}},

Your Bharat Gas LPG cylinder is out for delivery today!

Delivery Executive: {{delivery_person}}
Contact: {{delivery_contact}}
Amount Payable: ₹{{cash_amount}}

Please check the cylinder seal & test with soap water upon delivery.
Safety Helpline: 1906`,
  },
  {
    name: 'Bharat Gas - Agency Information Update',
    description: 'Official notice regarding LPG agency jurisdiction and contact numbers',
    body: `Dear {{customer_name}},

Your Bharat Gas distributor details are updated:

Agency Name: Alibag Bharat Gas Agency
Distributor Code: BG-410201
Showroom Address: Main Road, Alibag, Maharashtra 402201
Office Contact: 02141-222333
Emergency Leakage Helpline: 1906

We are committed to uninterrupted, safe LPG service for your household.`,
  },
  {
    name: 'Bharat Gas - Annual Safety Inspection',
    description: 'Mandatory LPG safety and rubber hose inspection reminder',
    body: `Dear {{customer_name}},

Mandatory LPG Safety Inspection is due for Consumer No: {{consumer_no}}.

Our certified Bharat Gas technician will visit your address for safety testing of the regulator, Suraksha hose, and burner stove.

Call Alibag Bharat Gas at 02141-222333 to schedule your preferred date.
Safety first, always!`,
  },
];

const VARIABLE_HELPERS = [
  { label: 'Customer Name', variable: '{{customer_name}}' },
  { label: 'Mobile Number', variable: '{{mobile_no}}' },
  { label: 'Consumer Number', variable: '{{consumer_no}}' },
  { label: 'Booking Ref', variable: '{{booking_no}}' },
  { label: 'Agency Name', variable: '{{agency_name}}' },
  { label: 'Refill Date', variable: '{{refill_date}}' },
  { label: 'Emergency Contact', variable: '{{emergency_contact}}' },
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Edit Modal State
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Live Preview Modal State
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [activePreviewTemplate, setActivePreviewTemplate] = useState<TemplateSummary | null>(null);
  const [previewCustomerId, setPreviewCustomerId] = useState<string>('');
  const [previewData, setPreviewData] = useState<TemplatePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchTemplatesAndCustomers = useCallback(async () => {
    try {
      const [tplRes, custRes] = await Promise.allSettled([
        api.templates.list(),
        api.customers.list(),
      ]);

      if (tplRes.status === 'fulfilled') {
        setTemplates(tplRes.value || []);
      }
      if (custRes.status === 'fulfilled') {
        setCustomers(custRes.value?.data || []);
        if (custRes.value?.data?.length > 0 && !previewCustomerId) {
          setPreviewCustomerId(custRes.value.data[0].id);
        }
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch templates.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [previewCustomerId]);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const [tplRes, custRes] = await Promise.allSettled([
          api.templates.list(),
          api.customers.list(),
        ]);

        if (ignore) return;

        if (tplRes.status === 'fulfilled') {
          setTemplates(tplRes.value || []);
        }
if (custRes.status === 'fulfilled') {
        setCustomers(custRes.value?.data || []);
        if (custRes.value?.data?.length > 0) {
          setPreviewCustomerId(custRes.value.data[0].id);
        }
      }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to fetch templates.');
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
    fetchTemplatesAndCustomers();
  };

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const matchSearch =
        searchQuery === '' ||
        tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tpl.description && tpl.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        tpl.body.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [templates, searchQuery]);

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateBody('');
    setSaveError(null);
    setEditorModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (tpl: TemplateSummary) => {
    setEditingTemplateId(tpl.id);
    setTemplateName(tpl.name);
    setTemplateDescription(tpl.description || '');
    setTemplateBody(tpl.body);
    setSaveError(null);
    setEditorModalOpen(true);
  };

  // Apply Preset
  const handleApplyPreset = (preset: typeof PRESET_BHARAT_TEMPLATES[0]) => {
    setTemplateName(preset.name);
    setTemplateDescription(preset.description);
    setTemplateBody(preset.body);
  };

  // Insert Variable helper
  const handleInsertVariable = (variable: string) => {
    setTemplateBody((prev) => prev + (prev.endsWith(' ') || prev === '' ? '' : ' ') + variable);
  };

  // Save Template
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName.trim()) {
      setSaveError('Please provide a template name.');
      return;
    }
    if (!templateBody.trim()) {
      setSaveError('Please enter the message body content.');
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);
      if (editingTemplateId) {
        await api.templates.update(editingTemplateId, {
          name: templateName.trim(),
          description: templateDescription.trim() || undefined,
          body: templateBody,
        });
      } else {
        await api.templates.create({
          name: templateName.trim(),
          description: templateDescription.trim() || undefined,
          body: templateBody,
        });
      }

      setEditorModalOpen(false);
      fetchTemplatesAndCustomers();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  // Archive Template
  const handleArchiveTemplate = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate/archive this template?')) return;
    try {
      await api.templates.archive(id);
      fetchTemplatesAndCustomers();
    } catch (err: unknown) {
      alert(`Archive failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Open Preview Modal
  const handleOpenPreview = async (tpl: TemplateSummary) => {
    setActivePreviewTemplate(tpl);
    setPreviewModalOpen(true);
    setPreviewLoading(true);

    const cId = previewCustomerId || (customers.length > 0 ? customers[0].id : '');
    if (cId) {
      try {
        const res = await api.templates.preview(tpl.id, cId);
        setPreviewData(res);
      } catch {
        // Render fallback preview
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    } else {
      setPreviewLoading(false);
    }
  };

  // Change Preview Customer
  const handlePreviewCustomerChange = async (customerId: string) => {
    setPreviewCustomerId(customerId);
    if (!activePreviewTemplate || !customerId) return;
    try {
      setPreviewLoading(true);
      const res = await api.templates.preview(activePreviewTemplate.id, customerId);
      setPreviewData(res);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Extract variables locally for badges
  const getVariablesFromText = (text: string) => {
    const matches = text.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
  };

  return (
    <AppShell onRefresh={handleRefresh} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider">
                WhatsApp Template Engine
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              Message Templates
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Create and manage personalized Bharat Gas refill reminders, KYC alerts, and emergency broadcast templates.
            </p>
          </div>

          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs hover:shadow transition-all active:scale-98 self-start sm:self-auto"
          >
            <PlusCircle className="h-4 w-4" />
            + Create Template
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

        {/* Search Bar */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search templates by title, description or keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-800 placeholder-slate-400 transition-all"
              />
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Showing <strong>{filteredTemplates.length}</strong> templates
            </div>
          </div>
        </Card>

        {/* Template Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-56 bg-slate-100 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={templates.length === 0 ? 'No message templates created yet' : 'No templates match your search'}
            description={
              templates.length === 0
                ? 'Create your first Bharat Gas template for refill confirmations, KYC reminders, or delivery notices.'
                : 'Try adjusting your search keywords.'
            }
            actionLabel={templates.length === 0 ? 'Create Template' : undefined}
            actionIcon={PlusCircle}
            onAction={handleOpenCreate}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
            {filteredTemplates.map((tpl) => {
              const vars = getVariablesFromText(tpl.body);
              const isActive = tpl.isActive ?? true;

              return (
                <Card
                  key={tpl.id}
                  className="flex flex-col justify-between hover:border-orange-300 hover:shadow-xs transition-all"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-800 border border-blue-200 uppercase tracking-wider">
                          Bharat Gas
                        </span>
                        <CardTitle className="text-sm font-bold text-slate-900 mt-1 truncate">
                          {tpl.name}
                        </CardTitle>
                      </div>
                      <StatusBadge status={isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                    {tpl.description && (
                      <CardDescription className="line-clamp-2 mt-1">
                        {tpl.description}
                      </CardDescription>
                    )}
                  </CardHeader>

                  <CardContent className="py-2 flex-1">
                    {/* Message Body Excerpt */}
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 whitespace-pre-wrap line-clamp-4 leading-relaxed">
                      {tpl.body}
                    </div>

                    {/* Dynamic Variables */}
                    {vars.length > 0 && (
                      <div className="mt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          Detected Variables ({vars.length}):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {vars.map((v) => (
                            <span
                              key={v}
                              className="text-[10px] font-mono font-bold text-orange-800 bg-orange-50 px-1.5 py-0.2 rounded border border-orange-200"
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="text-[11px] text-slate-400 font-mono">
                      {tpl.createdAt
                        ? new Date(tpl.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Custom'}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenPreview(tpl)}
                        className="p-1.5 text-slate-600 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors"
                        title="Live WhatsApp Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleOpenEdit(tpl)}
                        className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        title="Edit Template"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleArchiveTemplate(tpl.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="Archive / Deactivate"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {/* Create / Edit Template Modal */}
        <Modal
          isOpen={editorModalOpen}
          onClose={() => setEditorModalOpen(false)}
          title={editingTemplateId ? 'Edit Bharat Gas Template' : 'Create New Bharat Gas Template'}
          description="Design personalized customer broadcast templates with auto-substituting dynamic variables"
          maxWidth="2xl"
        >
          <form onSubmit={handleSaveTemplate} className="space-y-4">
            {/* Presets Quick Selector */}
            {!editingTemplateId && (
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#007BC9]">
                  <Sparkles className="h-4 w-4 text-orange-600" />
                  Quick Presets for Bharat Gas Agency:
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_BHARAT_TEMPLATES.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className="text-[11px] font-semibold px-2.5 py-1 bg-white hover:bg-orange-50 text-slate-800 hover:text-orange-800 border border-slate-200 hover:border-orange-300 rounded-lg transition-all shadow-2xs"
                    >
                      {preset.name.replace('Bharat Gas - ', '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Template Name */}
            <div>
              <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                Template Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Bharat Gas - Refill Booking Confirmation"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900 focus:outline-none"
              />
            </div>

            {/* Template Description */}
            <div>
              <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                Internal Description (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Sent when booking is confirmed by consumer via IVRS or web"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900 focus:outline-none"
              />
            </div>

            {/* Variable Insertion Chips */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Message Content *
                </label>
                <span className="text-[11px] text-slate-400">
                  Click variable to insert into cursor:
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {VARIABLE_HELPERS.map((item) => (
                  <button
                    key={item.variable}
                    type="button"
                    onClick={() => handleInsertVariable(item.variable)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold bg-slate-100 hover:bg-orange-100 text-slate-700 hover:text-orange-900 border border-slate-200 hover:border-orange-300 px-2 py-0.5 rounded transition-colors"
                  >
                    <Tag className="h-3 w-3 text-orange-600" />
                    {item.variable}
                  </button>
                ))}
              </div>

              <textarea
                required
                rows={7}
                placeholder="Dear {{customer_name}}, your Bharat Gas booking is confirmed..."
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                className="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Error Display */}
            {saveError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>{saveError}</div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditorModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-all"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Saving Template...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {editingTemplateId ? 'Update Template' : 'Save Template'}
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>

        {/* Live WhatsApp Preview Modal */}
        <Modal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          title={activePreviewTemplate ? `Preview: ${activePreviewTemplate.name}` : 'WhatsApp Preview'}
          description="Simulate real-time variable replacement on a recipient WhatsApp chat bubble"
          maxWidth="xl"
        >
          {activePreviewTemplate && (
            <div className="space-y-4">
              {/* Recipient Selector */}
              <div>
                <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                  Preview with Customer Data:
                </label>
                <select
                  value={previewCustomerId}
                  onChange={(e) => handlePreviewCustomerChange(e.target.value)}
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                >
                  {customers.length === 0 ? (
                    <option value="">No customers in database (using placeholder data)</option>
                  ) : (
                    customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (+91 {c.mobile})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* WhatsApp Phone Mock Container */}
              <div className="bg-[#E5DDD5] rounded-2xl p-4 border border-slate-300 shadow-inner max-w-md mx-auto relative overflow-hidden">
                {/* Chat Topbar */}
                <div className="bg-[#075E54] text-white p-3 -mx-4 -mt-4 mb-4 flex items-center gap-3 shadow-xs">
                  <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
                    BG
                  </div>
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1">
                      Bharat Gas Official
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    </div>
                    <div className="text-[10px] text-white/80">Verified Business Account</div>
                  </div>
                </div>

                {/* WhatsApp Chat Bubble */}
                {previewLoading ? (
                  <div className="p-6 bg-white rounded-lg shadow-sm animate-pulse space-y-2 max-w-xs">
                    <div className="h-4 bg-slate-200 rounded w-3/4" />
                    <div className="h-4 bg-slate-200 rounded w-full" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                  </div>
                ) : (
                  <div className="bg-white p-3.5 rounded-lg rounded-tl-none shadow-xs text-xs text-slate-800 space-y-2 max-w-xs relative border border-slate-100">
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {previewData?.rendered || activePreviewTemplate.body}
                    </div>
                    <div className="text-[10px] text-slate-400 text-right font-mono flex items-center justify-end gap-1">
                      <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <CheckCircle2 className="h-3 w-3 text-sky-500" />
                    </div>
                  </div>
                )}
              </div>

              {/* Missing Variables Warning if any */}
              {previewData && previewData.missing && previewData.missing.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Missing Variables for this customer:</strong>{' '}
                    {previewData.missing.join(', ')}. In campaign broadcast, these will trigger a safety alert.
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close Preview
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}
