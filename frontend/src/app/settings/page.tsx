'use client';

import React, { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  Save,
  Flame,
  Clock,
  Server,
} from 'lucide-react';

export default function SettingsPage() {
  const [agencyName, setAgencyName] = useState('Alibag Bharat Gas Agency');
  const [distributorCode, setDistributorCode] = useState('BG-410201');
  const [contactPhone, setContactPhone] = useState('02141-222333');
  const [emergencyPhone, setEmergencyPhone] = useState('1906');
  const [showroomAddress, setShowroomAddress] = useState(
    'Shop No. 4, Main Road, Alibag, Raigad, Maharashtra - 402201'
  );
  const [savedFeedback, setSavedFeedback] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 3000);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 border border-orange-500/20 text-[10px] font-bold uppercase tracking-wider">
                Agency Configuration
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#212529] mt-1">
              Agency Profile & Dispatch Settings
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage your Bharat Gas distributorship details, helpline contacts, and WhatsApp broadcasting parameters.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Agency Profile Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-[#007BC9]" />
                  Bharat Gas Agency Information
                </CardTitle>
                <CardDescription>
                  These details will be used in auto-populating agency variables for customer communication templates
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleSaveProfile}>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                        Distributorship Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={agencyName}
                        onChange={(e) => setAgencyName(e.target.value)}
                        className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                        Distributor Code *
                      </label>
                      <input
                        type="text"
                        required
                        value={distributorCode}
                        onChange={(e) => setDistributorCode(e.target.value)}
                        className="w-full text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                        Office Contact Phone *
                      </label>
                      <input
                        type="tel"
                        required
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        className="w-full text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                        Emergency Leakage Helpline *
                      </label>
                      <input
                        type="tel"
                        required
                        value={emergencyPhone}
                        onChange={(e) => setEmergencyPhone(e.target.value)}
                        className="w-full text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-[#212529] uppercase tracking-wider mb-1.5">
                      Showroom / Office Address
                    </label>
                    <textarea
                      rows={3}
                      value={showroomAddress}
                      onChange={(e) => setShowroomAddress(e.target.value)}
                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-900 leading-relaxed"
                    />
                  </div>

                  {savedFeedback && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Agency profile settings saved successfully.</span>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#007BC9] hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-xs transition-all"
                  >
                    <Save className="h-4 w-4" />
                    Save Agency Profile
                  </button>
                </CardFooter>
              </form>
            </Card>

            {/* Throttling Policy & Broadcast Safety Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
                  Meta WhatsApp Compliance & Broadcast Safety
                </CardTitle>
                <CardDescription>Policies enforced across all active campaign queues</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5 text-slate-900">
                      <Clock className="h-4 w-4 text-orange-600" />
                      Default Rate Limit Delay:
                    </span>
                    <span className="font-mono text-orange-700 bg-orange-100 px-2 py-0.5 rounded border border-orange-200">
                      19,000 ms (19 sec)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Maintains a steady pace of ~3 messages per minute per phone number ID to avoid triggering WhatsApp automated spam suspensions.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1.5 text-slate-900">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Max Retry Limit:
                    </span>
                    <span className="font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200">
                      3 Attempts
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Failed message dispatches are retried up to 3 times before marked permanently failed with error trace.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Info & System Environment */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-[#007BC9]" />
                  System Diagnostics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <span className="text-xs text-slate-500 font-bold uppercase">Backend API URL</span>
                  <div className="font-mono text-xs text-slate-800 break-all">
                    {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <span className="text-xs text-slate-500 font-bold uppercase">Next.js Framework</span>
                  <div className="font-mono text-[11px] text-slate-800">
                    Next.js 16.3.5 (React 19)
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <span className="text-xs text-slate-500 font-bold uppercase">Database Layer</span>
                  <div className="font-mono text-[11px] text-slate-800">
                    PostgreSQL 18 + Prisma
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-[#007BC9] to-[#0066A8] text-white border border-blue-700 shadow-sm">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-[#FFDC02]" />
                  <span className="font-bold text-base">Emergency Protocols</span>
                </div>
                <p className="text-xs text-blue-100 leading-relaxed">
                  In case of gas leakage reports or emergency refill requests, instruct consumers to call the national emergency LPG toll-free number:
                </p>
                <div className="p-2.5 bg-white/10 rounded-lg border border-white/10 text-center font-mono font-bold text-[#FFDC02] text-base">
                  1906 (24x7 Leakage Hotline)
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
