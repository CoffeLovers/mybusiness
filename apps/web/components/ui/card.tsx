import type { HTMLAttributes } from 'react';

import { cn } from './cn';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-2xl border border-border/80 bg-surface-raised p-5 shadow-xs transition-all',
        className,
      )}
    />
  );
}
