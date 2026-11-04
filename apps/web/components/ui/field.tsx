'use client';

import { useId, type ReactNode } from 'react';

import { cn } from './cn';
import { type FieldControlProps } from './field-classes';

export type { FieldControlProps };

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-expense">
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        required,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-expense">
          {error}
        </p>
      ) : null}
    </div>
  );
}
