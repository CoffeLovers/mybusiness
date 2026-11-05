'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from './cn';
import { fieldControlClasses } from './field-classes';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select {...props} ref={ref} className={cn(fieldControlClasses, 'cursor-pointer', className)} />
  );
});
