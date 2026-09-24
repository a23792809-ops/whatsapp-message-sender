'use client';

import React, { useState } from 'react';
import { Menu, Search, RefreshCw, HelpCircle, Bell, LogOut, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

interface TopbarProps {
  onMenuClick: () => void;
  isBackendConnected: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function Topbar({
  onMenuClick,
  isBackendConnected,
  onRefresh,
  isRefreshing = false,
}: TopbarProps) {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 shadow-sm">
      {/* Left: Mobile Menu Trigger & Search */}
      <div className="flex items-center gap-3 sm:gap-4 flex-1 max-w-lg">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-[#007BC9] hover:bg-blue-50 transition-colors"
          aria-label="Toggle navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative flex-1 hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
          <input
            type="text"
            placeholder="Search Bharat Gas customers, refill templates, campaigns..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-800 placeholder-slate-500 transition-all"
          />
        </div>
      </div>

      {/* Right: Actions, Backend Health Indicator & Agency Status */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            title="Refresh Live Data"
          >
            <RefreshCw className={`h-4.5 w-4.5 ${isRefreshing ? 'animate-spin text-[#007BC9]' : ''}`} />
          </button>
        )}

        {/* Notifications */}
        <button
          className="relative p-2 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
          title="Notifications"
        >
          <Bell className="h-4.5 w-4.5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#FFDC02] border border-white" />
        </button>

        {/* Backend Connection Status Pill */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
            isBackendConnected
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isBackendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="hidden md:inline">
            {isBackendConnected ? 'Server Connected' : 'Server Offline'}
          </span>
          <span className="md:hidden">
            {isBackendConnected ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* Help & Helpline */}
        <Link
          href="/settings"
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-slate-200"
          title="Bharat Gas Emergency Hotline: 1906"
        >
          <HelpCircle className="h-4 w-4 text-[#007BC9]" />
          <span>LPG Helpline: 1906</span>
        </Link>

        {/* Agency Operator Avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="h-9 w-9 rounded-full bg-[#007BC9] text-[#FFDC02] border-2 border-[#FFDC02] flex items-center justify-center font-bold text-sm shadow-xs">
            {user ? user.username.slice(0, 2).toUpperCase() : 'BG'}
          </div>
          <div className="hidden lg:block text-left">
            <span className="text-sm font-semibold text-slate-800 block leading-tight">
              {user ? user.username : 'Agency'}
            </span>
            <span className="text-xs text-slate-500 block leading-tight">
              Distribution Desk
            </span>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="p-2 ml-1 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-60"
            title="Sign out"
            aria-label="Sign out"
          >
            {loggingOut ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <LogOut className="h-4.5 w-4.5" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}