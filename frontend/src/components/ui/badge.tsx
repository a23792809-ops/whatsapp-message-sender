import React from 'react';
import { CheckCircle2, Clock, AlertOctagon, PauseCircle, PlayCircle, FileText, Ban, Eye } from 'lucide-react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-700 border-slate-200',
  primary: 'bg-blue-50 text-blue-800 border-blue-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function Badge({ children, variant = 'default', className = '', size = 'md', ...props }: BadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-md border ${sizeClasses} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, showIcon = true }: { status: string; showIcon?: boolean }) {
  const upper = status?.toUpperCase() || 'UNKNOWN';

  let variant: BadgeVariant = 'neutral';
  let Icon = FileText;

  switch (upper) {
    case 'SENT':
    case 'COMPLETED':
    case 'CONNECTED':
    case 'ACTIVE':
    case 'DELIVERED':
      variant = 'success';
      Icon = CheckCircle2;
      break;
    // READ is the furthest a delivery can get, so it is shown distinctly from
    // DELIVERED rather than collapsing the two into one indistinguishable
    // green badge.
    case 'READ':
      variant = 'success';
      Icon = Eye;
      break;
    case 'RUNNING':
      variant = 'info';
      Icon = PlayCircle;
      break;
    case 'PAUSED':
    case 'PENDING':
    case 'QUEUED':
      variant = 'warning';
      Icon = upper === 'PAUSED' ? PauseCircle : Clock;
      break;
    case 'FAILED':
    case 'ERROR':
    case 'DISCONNECTED':
      variant = 'danger';
      Icon = AlertOctagon;
      break;
    case 'STOPPED':
      variant = 'danger';
      Icon = Ban;
      break;
    case 'DRAFT':
    default:
      variant = 'neutral';
      Icon = FileText;
      break;
  }

  return (
    <Badge variant={variant}>
      {showIcon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span>{upper}</span>
    </Badge>
  );
}
