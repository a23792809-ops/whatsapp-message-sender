import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`p-8 sm:p-12 text-center rounded-xl border border-dashed border-blue-300 bg-white ${className}`}>
      <div className="mx-auto h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#007BC9] mb-3.5 shadow-xs">
        <Icon className="h-6 w-6 text-[#007BC9]" />
      </div>
      <h3 className="text-lg font-semibold text-[#212529]">{title}</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007BC9] hover:bg-blue-700 text-white text-sm font-semibold shadow-xs hover:shadow transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {ActionIcon && <ActionIcon className="h-4 w-4" />}
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-[#212529] text-sm font-semibold shadow-xs transition-all duration-150"
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
