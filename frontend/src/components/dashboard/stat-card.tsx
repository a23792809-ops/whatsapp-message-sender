import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Card } from '../ui/card';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'orange';
  loading?: boolean;
  error?: boolean;
}

const variantStyles = {
  default: {
    icon: 'text-[#007BC9] bg-blue-50 border-blue-200',
    accent: 'text-[#212529]',
  },
  primary: {
    icon: 'text-[#FFDC02] bg-[#007BC9] border-blue-700',
    accent: 'text-[#007BC9]',
  },
  orange: {
    icon: 'text-[#998a00] bg-yellow-50 border-yellow-200',
    accent: 'text-[#736600]',
  },
  success: {
    icon: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    accent: 'text-emerald-950',
  },
  warning: {
    icon: 'text-amber-700 bg-amber-50 border-amber-200',
    accent: 'text-amber-950',
  },
  danger: {
    icon: 'text-rose-700 bg-rose-50 border-rose-200',
    accent: 'text-rose-950',
  },
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  loading = false,
  error = false,
}: StatCardProps) {
  const currentVariant = variantStyles[variant] || variantStyles.default;

  const displayValue = error || loading ? '—' : value;
  const displaySubtitle = error
    ? 'Unable to load'
    : loading
      ? 'Loading...'
      : subtitle;

  return (
    <Card
      className="p-5 flex flex-col justify-between border-slate-200 shadow-sm hover:border-blue-300 transition-colors"
      aria-label={`${title}: ${displayValue}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{title}</span>
        <div className={`p-2.5 rounded-lg border ${currentVariant.icon}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="h-8 w-24 bg-slate-200 animate-pulse rounded-md my-1" />
        ) : (
          <div
            className={`text-2xl sm:text-3xl font-bold tracking-tight ${
              error
                ? 'text-slate-300 font-semibold'
                : currentVariant.accent
            }`}
          >
            {value}
          </div>
        )}

        {displaySubtitle && (
          <p className={`text-sm mt-1 font-medium ${error ? 'text-slate-400' : 'text-slate-500'}`}>
            {displaySubtitle}
          </p>
        )}
      </div>
    </Card>
  );
}