import type { HTMLAttributes } from 'react';

import { cn } from './cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ lines = 1, className, ...props }: SkeletonProps) {
  return (
    <div {...props} aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <div
          key={index}
          className={cn(
            'h-4 animate-pulse rounded-md bg-surface-raised',
            lines > 1 && index === lines - 1 ? 'w-2/3' : undefined,
          )}
        />
      ))}
    </div>
  );
}
