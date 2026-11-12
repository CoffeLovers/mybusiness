'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';
type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary/90 active:bg-primary/95',
  secondary:
    'border border-border-strong bg-surface text-text hover:bg-surface-raised active:bg-surface-raised',
  ghost: 'text-primary hover:bg-surface-raised active:bg-surface-raised',
  danger: 'bg-expense text-on-primary hover:bg-expense/90 active:bg-expense/95',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 py-2 text-sm',
  lg: 'min-h-12 px-6 py-3 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    type = 'button',
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      aria-busy={loading ? true : undefined}
      disabled={disabled === true || loading}
    >
      {loading ? (
        <svg
          aria-hidden="true"
          className="size-3 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" className="opacity-25" />
          <path d="M22 12a10 10 0 0 0-10-10" className="opacity-75" />
        </svg>
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant = 'primary', label, type = 'button', children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(baseClasses, 'min-h-11 min-w-11 p-0', variantClasses[variant], className)}
    >
      {children}
    </button>
  );
});
