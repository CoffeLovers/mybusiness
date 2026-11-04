import type { HTMLAttributes } from 'react';

import { cn } from './cn';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn('rounded-lg border border-border bg-surface-raised p-4', className)}
    />
  );
}
