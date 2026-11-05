import type { HTMLAttributes } from 'react';

import { cn } from './cn';

export type ChipTone = 'neutral' | 'income' | 'expense' | 'alert';

const baseClasses =
  'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium';

const toneClasses: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-raised text-neutral',
  income: 'border-income/40 bg-surface-raised text-income',
  expense: 'border-expense/40 bg-surface-raised text-expense',
  alert: 'border-alert/40 bg-surface-raised text-alert',
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
}

export function Chip({ className, tone = 'neutral', ...props }: ChipProps) {
  return <span {...props} className={cn(baseClasses, toneClasses[tone], className)} />;
}

export function StatusBadge({ className, tone = 'neutral', children, ...props }: ChipProps) {
  return (
    <Chip {...props} tone={tone} className={className}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </Chip>
  );
}
