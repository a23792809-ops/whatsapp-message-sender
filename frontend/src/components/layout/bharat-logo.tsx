import React from 'react';
import { Flame } from 'lucide-react';

interface BharatLogoProps {
  size?: 'sm' | 'md' | 'lg';
  collapsed?: boolean;
  tone?: 'light' | 'dark';
}

export function BharatLogo({ size = 'md', collapsed = false, tone = 'light' }: BharatLogoProps) {
  const iconSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  const boxSize = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-11 w-11' : 'h-10 w-10';
  const isLight = tone === 'light';
  const titleSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-base';

  return (
    <div className="flex items-center gap-3">
      {/* Bharat Gas Flame & Shield Icon Mark */}
      <div
        className={`${boxSize} rounded-lg bg-white flex items-center justify-center shadow-md border border-white/90 relative overflow-hidden shrink-0`}
      >
        <Flame className={`${iconSize} text-[#007BC9] fill-[#FFDC02]/30`} />
        <span className="absolute inset-x-0 bottom-0 h-1 bg-[#FFDC02]" />
      </div>

      {!collapsed && (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-bold tracking-tight block leading-tight ${titleSize} ${isLight ? 'text-white' : 'text-slate-900'}`}>
              Bharat Gas
            </span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#FFDC02] text-[#212529] uppercase tracking-wide shrink-0">
              LPG
            </span>
          </div>
          <span className={`text-xs font-medium tracking-tight block truncate ${isLight ? 'text-blue-100' : 'text-slate-500'}`}>
            Message Center
          </span>
        </div>
      )}
    </div>
  );
}