import { createElement, type ReactNode } from 'react';

import { cn } from './cn';

export type TitleElement = 'p' | 'h2' | 'h3';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  titleAs?: TitleElement;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  titleAs = 'p',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface p-6 text-center',
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="text-text-muted">
          {icon}
        </div>
      ) : null}
      {createElement(titleAs, { className: 'text-base font-semibold text-text' }, title)}
      {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
