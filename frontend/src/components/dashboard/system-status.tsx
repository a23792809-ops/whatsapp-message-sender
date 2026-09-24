import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { HealthResponse, WhatsAppStatusResponse } from '@/lib/api';
import {
  Server,
  Database,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ArrowUpRight,
  HelpCircle,
} from 'lucide-react';

interface SystemStatusProps {
  health: HealthResponse | null;
  whatsapp: WhatsAppStatusResponse | null;
  loading?: boolean;
  waError?: string | null;
  healthError?: string | null;
}

type WaState = 'connected' | 'dry' | 'missing' | 'error';

function resolveWaState(
  whatsapp: WhatsAppStatusResponse | null,
  waError: string | null,
): { state: WaState; label: string } {
  if (waError) return { state: 'error', label: 'Unable to verify' };
  if (!whatsapp) return { state: 'error', label: 'Unable to verify' };
  if (!whatsapp.configured) return { state: 'missing', label: 'Configuration Missing' };
  const isDryRun = whatsapp.dryRun ?? whatsapp.mode === 'dry';
  if (isDryRun) return { state: 'dry', label: 'Dry Run Mode' };
  return { state: 'connected', label: 'Connected / Ready' };
}

export function SystemStatus({ health, whatsapp, loading = false, waError = null }: SystemStatusProps) {
  const isBackendOk = health?.status === 'ok';
  const isDbOk = health?.database?.connected ?? false;
  const wa = resolveWaState(whatsapp, waError);

  const waBadge = {
    connected:
      'text-emerald-800 bg-emerald-50 border-emerald-200',
    dry: 'text-yellow-800 bg-yellow-50 border-yellow-300',
    missing: 'text-slate-700 bg-slate-100 border-slate-200',
    error: 'text-rose-800 bg-rose-50 border-rose-200',
  }[wa.state];

  const WaIcon =
    wa.state === 'connected'
      ? CheckCircle2
      : wa.state === 'dry'
        ? AlertTriangle
        : wa.state === 'missing'
          ? AlertTriangle
          : HelpCircle;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#007BC9]" />
          System & Engine Status
        </CardTitle>
        <CardDescription>Agency API runtime, PostgreSQL database & WhatsApp Cloud API status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-100 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {/* Backend NestJS */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-white border border-blue-200 text-[#007BC9]">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[#212529]">NestJS Core Engine</h4>
                  <p className="text-xs text-slate-500 font-mono">Port 3001 • REST Server</p>
                </div>
              </div>
              <div>
                {isBackendOk ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Operational
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-800 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Disconnected
                  </span>
                )}
              </div>
            </div>

            {/* PostgreSQL & Database */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-white border border-blue-200 text-[#007BC9]">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[#212529]">PostgreSQL Database</h4>
                  <p className="text-xs text-slate-500">
                    {isDbOk
                      ? `${health?.database?.customers || 0} Customers • ${health?.database?.messages || 0} Messages`
                      : 'Database offline'}
                  </p>
                </div>
              </div>
              <div>
                {isDbOk ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-800 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Offline
                  </span>
                )}
              </div>
            </div>

            {/* WhatsApp Cloud API */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-md bg-white border border-blue-200 text-[#007BC9]">
                  <Smartphone className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-[#212529]">Meta Cloud WhatsApp</h4>
                  <p className="text-xs text-slate-500 font-mono truncate">
                    {wa.state === 'error' || !whatsapp
                      ? 'Status unavailable'
                      : `API ${whatsapp.apiVersion || '—'} • Mode ${
                          whatsapp.mode || (wa.state === 'dry' ? 'dry' : 'live')
                        }`}
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border ${waBadge}`}
                >
                  <WaIcon className="h-3.5 w-3.5" /> {wa.label}
                </span>
              </div>
            </div>

            <Link
              href="/whatsapp"
              className="flex items-center justify-center gap-1 text-sm font-semibold text-[#007BC9] hover:text-blue-700 hover:bg-blue-50 rounded-lg py-2 transition-colors"
            >
              Open WhatsApp settings <ArrowUpRight className="h-4 w-4" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}