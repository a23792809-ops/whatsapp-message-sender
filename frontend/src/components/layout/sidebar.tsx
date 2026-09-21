'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FileText,
  Send,
  MessageSquare,
  Smartphone,
  Settings,
  X,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { BharatLogo } from './bharat-logo';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Templates', href: '/templates', icon: FileText },
  { label: 'Campaigns', href: '/campaigns', icon: Send },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'WhatsApp API', href: '/whatsapp', icon: Smartphone },
  { label: 'Agency Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  const isCurrentActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-[#007BC9] text-blue-50 border-r border-blue-700 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand / Logo Header */}
        <div className="flex items-center justify-between px-5 h-20 border-b border-white/10 bg-[#007BC9]">
          <BharatLogo size="lg" />
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-blue-100 hover:text-white hover:bg-white/10"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Agency Badge Tag */}
        <div className="px-4 pt-4 pb-2">
          <div className="px-3 py-2.5 rounded-lg bg-white/10 border border-white/15 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <Building2 className="h-4 w-4 text-[#FFDC02] shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white block truncate">
                  Alibag Bharat Gas
                </span>
                <span className="text-[11px] text-blue-100 font-mono block">
                  Code: BG-410201
                </span>
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="System Online" />
          </div>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-xs font-bold text-blue-100 uppercase tracking-wider">
            LPG Communications
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isCurrentActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (window.innerWidth < 1024) onClose();
                }}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 relative ${
                  isActive
                    ? 'bg-[#FFDC02] text-[#00304A] shadow-sm'
                    : 'text-blue-50 hover:bg-white/10 hover:text-white'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#005586]" />
                )}
                <Icon
                  className={`h-5 w-5 shrink-0 ${
                    isActive ? 'text-[#00304A]' : 'text-blue-100'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Operational Safety & Operator Profile Footer */}
        <div className="p-3.5 border-t border-white/10 bg-[#0066A8] space-y-2.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/10 border border-white/15">
            <ShieldCheck className="h-4 w-4 text-[#FFDC02] shrink-0" />
            <div className="text-[11px] text-blue-50 truncate">
              <span className="font-semibold text-white">Meta Cloud API:</span> Active
            </div>
            <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FFDC02] text-[#212529] uppercase shrink-0">
              Throttled
            </span>
          </div>

          <div className="flex items-center gap-2.5 px-2 pt-1">
            <div className="h-8 w-8 rounded-full bg-[#FFDC02] flex items-center justify-center font-bold text-xs text-[#00304A] shadow-xs shrink-0 border border-white/40">
              BG
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">Agency Admin</p>
              <p className="text-[11px] text-blue-100 truncate">operator@bharatgas.in</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}