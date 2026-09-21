'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import {
  api,
  WhatsAppStatusResponse,
} from '@/lib/api';
import {
  Smartphone,
  CheckCircle2,
  Send,
  RefreshCw,
  ShieldCheck,
  Radio,
  AlertCircle,
} from 'lucide-react';

export default function WhatsAppPage() {
  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Test Message State
  const [testMobile, setTestMobile] = useState('');
  const [testMessage, setTestMessage] = useState(
    'Namaste! This is an official test message from Alibag Bharat Gas Agency via WhatsApp Cloud API.'
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    mode?: string;
    whatsappId?: string;
    error?: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.whatsapp.status();
      setStatus(res);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch WhatsApp gateway status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const res = await api.whatsapp.status();
        if (!ignore) {
          setStatus(res);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to fetch WhatsApp gateway status.');
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
    fetchStatus();
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testMobile.trim()) {
      alert('Please enter a recipient mobile number.');
      return;
    }

    try {
      setSendingTest(true);
      setTestResult(null);
      const res = await api.whatsapp.test(testMobile.trim(), testMessage.trim());
      setTestResult(res);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to dispatch test message.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const isConfigured = status?.configured ?? false;
  const isDryRun = status?.dryRun ?? (status?.mode === 'dry' || !isConfigured);

  return (
    <AppShell onRefresh={handleRefresh} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-blue-50 text-[#007BC9] border border-blue-200 text-xs font-bold uppercase tracking-wider">
                Gateway Integration
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              WhatsApp Business API Connection
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Meta WhatsApp Cloud API configuration, gateway health diagnostics, and direct test dispatch console.
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* WhatsApp API Connection Status */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-[#007BC9]" />
                  Gateway Status
                </CardTitle>
                <CardDescription>Meta Cloud API health & authentication state</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="space-y-3">
                    <div className="h-10 bg-slate-100 animate-pulse rounded-lg" />
                    <div className="h-10 bg-slate-100 animate-pulse rounded-lg" />
                  </div>
                ) : (
                  <>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#212529]">Connection State:</span>
                        <span
                          className={`inline-flex items-center gap-1 text-sm font-bold px-3 py-1 rounded-full border ${
                            isConfigured
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                            }`}
                          />
                          {isConfigured ? 'CONNECTED' : 'CONFIG REQUIRED'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#212529]">Engine Mode:</span>
                        <span
                          className={`text-sm font-bold px-3 py-1 rounded-full border ${
                            isDryRun
                              ? 'bg-[#FFDC02] text-[#212529] border-yellow-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {isDryRun ? 'DRY-RUN SIMULATOR' : 'LIVE GATEWAY'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#212529]">API Version:</span>
                        <span className="text-sm font-mono text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                          {status?.apiVersion || 'v21.0'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#212529]">Phone Number ID:</span>
                        <span className="text-sm font-mono text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200 truncate max-w-[140px]">
                          {status?.phoneNumberId || 'Not set'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#212529]">Access Token:</span>
                        <span className="text-sm font-mono text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                          {status?.accessToken || (isConfigured ? '••••••••' : 'Not set')}
                        </span>
                      </div>
                    </div>

                    {isDryRun && (
                      <div className="p-3.5 rounded-lg bg-yellow-50 border border-yellow-300 text-sm text-yellow-900 space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-[#736600]">
                          <Radio className="h-4 w-4 text-[#FFDC02]" />
                          Dry-Run Mode Active:
                        </div>
                        <p className="text-xs text-yellow-900 leading-relaxed">
                          The system simulates message delivery and logs without consuming Meta API credits. Set credentials in <code className="bg-white/80 px-1 py-0.5 rounded border border-yellow-200 font-mono">.env</code> to switch to live delivery.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Meta WhatsApp Guidelines */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#007BC9]" />
                  Bharat Gas API Guidelines
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600 space-y-2 leading-relaxed">
                <p>
                  • <strong>Anti-Spam Throttling:</strong> Keep broadcast intervals between 15-20 seconds per customer.
                </p>
                <p>
                  • <strong>Personalization:</strong> Always ensure customer name and mobile numbers are fully validated.
                </p>
                <p>
                  • <strong>Emergency Support:</strong> Include the official LPG Leakage Helpline (1906) on delivery messages.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Test WhatsApp Message Console */}
          <div className="lg:col-span-2">
            <Card className="h-full flex flex-col justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-[#007BC9]" />
                  Test WhatsApp Message Dispatch
                </CardTitle>
                <CardDescription>
                  Send a real-time test message through the existing backend endpoint (/whatsapp/test)
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleSendTestMessage} className="flex flex-col flex-1 justify-between">
                <CardContent className="space-y-4">
                  {/* Recipient Mobile */}
                  <div>
                    <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                      Recipient Mobile Number *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
                        +91
                      </span>
                      <input
                        type="tel"
                        required
                        placeholder="9876543210"
                        value={testMobile}
                        onChange={(e) => setTestMobile(e.target.value)}
                        className="w-full pl-12 pr-4 py-2.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                      />
                    </div>
                    <span className="text-xs text-slate-500 mt-1 block">
                      10-digit Indian mobile number with active WhatsApp
                    </span>
                  </div>

                  {/* Message Content */}
                  <div>
                    <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                      Test Message Body *
                    </label>
                    <textarea
                      required
                      rows={5}
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      className="w-full font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900 leading-relaxed"
                    />
                  </div>

                  {/* Test Execution Result */}
                  {testResult && (
                    <div
                      className={`p-4 rounded-xl border text-sm space-y-1.5 ${
                        testResult.ok
                          ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                          : 'bg-rose-50 text-rose-950 border-rose-200'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5">
                        {testResult.ok ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            Message Dispatched Successfully!
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-4 w-4 text-rose-600" />
                            Dispatch Failed
                          </>
                        )}
                      </div>
                      {testResult.whatsappId && (
                        <div className="font-mono text-xs text-emerald-800 bg-white/70 p-2 rounded border border-emerald-200">
                          <strong>WhatsApp Message ID:</strong> {testResult.whatsappId} (Mode: {testResult.mode || 'standard'})
                        </div>
                      )}
                      {testResult.error && (
                        <div className="font-mono text-xs text-rose-800 bg-white/70 p-2 rounded border border-rose-200">
                          <strong>Error Details:</strong> {testResult.error}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Endpoint: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">POST /whatsapp/test</code>
                  </div>
                  <button
                    type="submit"
                    disabled={sendingTest}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#007BC9] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-xs transition-all"
                  >
                    {sendingTest ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Dispatching Test...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Send Test WhatsApp Message
                      </>
                    )}
                  </button>
                </CardFooter>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
