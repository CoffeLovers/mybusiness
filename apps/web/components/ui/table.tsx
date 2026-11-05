import type { ComponentPropsWithoutRef } from 'react';

import { cn } from './cn';

export type TableProps = ComponentPropsWithoutRef<'table'> & { label?: string };

export function Table({ className, label = 'Tabla de datos', ...props }: TableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="w-full overflow-x-auto rounded-lg border border-border"
    >
      <table {...props} className={cn('w-full border-collapse text-sm', className)} />
    </div>
  );
}

export type TableHeadProps = ComponentPropsWithoutRef<'thead'>;

export function TableHead({ className, ...props }: TableHeadProps) {
  return <thead {...props} className={cn('bg-surface-raised', className)} />;
}

export type TableBodyProps = ComponentPropsWithoutRef<'tbody'>;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody {...props} className={className} />;
}

export type TableRowProps = ComponentPropsWithoutRef<'tr'>;

export function TableRow({ className, ...props }: TableRowProps) {
  return <tr {...props} className={cn('hover:bg-surface-raised', className)} />;
}

export type TableHeaderCellProps = ComponentPropsWithoutRef<'th'>;

export function TableHeaderCell({ className, scope = 'col', ...props }: TableHeaderCellProps) {
  return (
    <th
      {...props}
      scope={scope}
      className={cn(
        'border-b border-border px-3 py-2 text-left font-medium text-text-muted',
        className,
      )}
    />
  );
}

export type TableCellProps = ComponentPropsWithoutRef<'td'>;

export function TableCell({ className, ...props }: TableCellProps) {
  return <td {...props} className={cn('border-b border-border px-3 py-2 text-text', className)} />;
}
