import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { HealthResponse, WhatsAppStatusResponse } from '@/lib/api';
import { Server, Database, Smartphone, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface SystemStatusProps {
  health: HealthResponse | null;
  whatsapp: WhatsAppStatusResponse | null;
  loading?: boolean;
}

export function SystemStatus({ health, whatsapp, loading = false }: SystemStatusProps) {
  const isBackendOk = health?.status === 'ok';
  const isDbOk = health?.database?.connected ?? false;
  const isWaDryRun = whatsapp?.dryRun ?? (whatsapp?.mode === 'dry' || !whatsapp?.configured);

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
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-white border border-blue-200 text-[#007BC9]">
                  <Smartphone className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[#212529]">Meta Cloud WhatsApp</h4>
                  <p className="text-xs text-slate-500 font-mono">
                    API {whatsapp?.apiVersion || 'v21.0'}
                  </p>
                </div>
              </div>
              <div>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border ${
                  isWaDryRun
                    ? 'text-yellow-800 bg-yellow-50 border-yellow-300'
                    : 'text-emerald-800 bg-emerald-50 border-emerald-200'
                }`}>
                  {isWaDryRun ? 'DRY RUN' : 'LIVE GATEWAY'}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}