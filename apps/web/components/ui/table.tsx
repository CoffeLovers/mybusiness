'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from './cn';

export type TableDensity = 'comfortable' | 'compact';

export const TABLE_DENSITY_STORAGE_KEY = 'mybusiness.table.density';

export interface TableContextValue {
  density: TableDensity;
}

export const TableContext = createContext<TableContextValue>({ density: 'comfortable' });

export function useTableContext(): TableContextValue {
  return useContext(TableContext);
}

export type TableProps = ComponentPropsWithoutRef<'table'> & {
  label?: string;
  density?: TableDensity;
};

export function Table({
  className,
  label = 'Tabla de datos',
  density = 'comfortable',
  ...props
}: TableProps) {
  return (
    <TableContext.Provider value={{ density }}>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <table
          {...props}
          className={cn(
            'w-full border-collapse',
            density === 'compact' ? 'text-xs' : 'text-sm',
            className,
          )}
        />
      </div>
    </TableContext.Provider>
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
  const { density } = useTableContext();

  return (
    <th
      {...props}
      scope={scope}
      className={cn(
        'border-b border-border text-left font-medium text-text-muted',
        density === 'compact' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm',
        className,
      )}
    />
  );
}

export type TableCellProps = ComponentPropsWithoutRef<'td'>;

export function TableCell({ className, ...props }: TableCellProps) {
  const { density } = useTableContext();

  return (
    <td
      {...props}
      className={cn(
        'border-b border-border text-text',
        density === 'compact' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm',
        className,
      )}
    />
  );
}

/** Hook para gestionar y persistir la densidad de tabla en localStorage por usuario. */
export function useTableDensity(storageKey = TABLE_DENSITY_STORAGE_KEY) {
  const [density, setDensityState] = useState<TableDensity>('comfortable');

  useEffect(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
      if (stored === 'compact' || stored === 'comfortable') {
        setDensityState(stored);
      }
    } catch {
      // Entorno restringido o navegación privada sin acceso a localStorage
    }
  }, [storageKey]);

  const setDensity = useCallback(
    (next: TableDensity) => {
      setDensityState(next);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(storageKey, next);
        }
      } catch {
        // Ignorar fallos de cuota o permisos en localStorage
      }
    },
    [storageKey],
  );

  return { density, setDensity };
}

export interface TableDensityToggleProps {
  density: TableDensity;
  onChange: (density: TableDensity) => void;
  className?: string;
}

/** Selector accesible de densidad para tablas (WCAG 2.1 AA+). */
export function TableDensityToggle({ density, onChange, className }: TableDensityToggleProps) {
  return (
    <div
      role="group"
      aria-label="Densidad de la tabla"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={density === 'comfortable'}
        onClick={() => {
          onChange('comfortable');
        }}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none',
          density === 'comfortable'
            ? 'bg-primary text-on-primary'
            : 'text-text-muted hover:bg-surface-raised hover:text-text',
        )}
      >
        Cómoda
      </button>
      <button
        type="button"
        aria-pressed={density === 'compact'}
        onClick={() => {
          onChange('compact');
        }}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none',
          density === 'compact'
            ? 'bg-primary text-on-primary'
            : 'text-text-muted hover:bg-surface-raised hover:text-text',
        )}
      >
        Compacta
      </button>
    </div>
  );
}
