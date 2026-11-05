import type { ReactNode } from 'react';

import { cn } from './cn';

export type InlineBannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface InlineBannerProps {
  tone?: InlineBannerTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<InlineBannerTone, string> = {
  info: 'border-primary/40 bg-surface-raised text-primary',
  success: 'border-income/40 bg-surface-raised text-income',
  warning: 'border-alert/40 bg-surface-raised text-alert',
  danger: 'border-expense/40 bg-surface-raised text-expense',
};

export function InlineBanner({ tone = 'info', title, children, className }: InlineBannerProps) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'note'}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3 text-sm',
        toneClasses[tone],
        className,
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
