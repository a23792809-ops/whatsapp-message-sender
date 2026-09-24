'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, Lock, User, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Branded Panel */}
      <div className="lg:flex-1 lg:flex lg:flex-col lg:justify-center lg:items-center bg-[#007BC9] px-8 py-12 text-blue-50">
        <div className="max-w-md w-full flex flex-col items-center lg:items-start text-center lg:text-left">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-lg bg-white flex items-center justify-center shadow-md border border-white/90 relative overflow-hidden">
              <Flame className="h-6 w-6 text-[#007BC9] fill-[#FFDC02]/30" />
              <span className="absolute inset-x-0 bottom-0 h-1 bg-[#FFDC02]" />
            </div>
            <div>
              <p className="font-bold text-white text-lg leading-tight">Bharat Gas</p>
              <p className="text-xs font-medium text-blue-100 tracking-tight">Message Center</p>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">
            Secure Agency Portal
          </h1>
          <p className="text-blue-100 leading-relaxed mb-8">
            Sign in to broadcast refill reminders, first-fill welcomes and personalised
            LPG updates to your customers over WhatsApp.
          </p>

          <div className="w-full space-y-2.5">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-sm">
              <ShieldCheck className="h-5 w-5 text-[#FFDC02] shrink-0" />
              <span className="text-blue-50">Authorised dealership operators only</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-sm">
              <Lock className="h-5 w-5 text-[#FFDC02] shrink-0" />
              <span className="text-blue-50">Session expires automatically for safety</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sign-in Form */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-slate-900 mb-1">Administrator Sign In</h2>
            <p className="text-sm text-slate-500">Enter your agency credentials to continue.</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800"
            >
              <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-800 placeholder-slate-500 transition-all"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-800 placeholder-slate-500 transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#007BC9] text-white text-sm font-semibold hover:bg-[#0066A8] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in to Portal'
              )}
            </button>
          </form>

          <p className="mt-8 text-xs text-slate-400 leading-relaxed">
            Authorized personnel only. All portal activity is protected by the Bharat Gas
            agency security policy.
          </p>
        </div>
      </div>
    </div>
  );
}