'use client';

/**
 * Controles y utilidades de cliente del libro mayor.
 *
 * Se extraen de `LedgerView` para mantener ese archivo por debajo de 700 líneas:
 * aquí viven la barra de filtros, la paginación, la barra de acciones masivas,
 * el selector de vistas guardadas, el chip de conciliación, la celda de importe
 * y las utilidades compartidas de petición (CSRF de doble envío, lectura de
 * códigos de error y normalización de vistas).
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  LedgerQueryDto,
  LedgerRowResponse,
  SavedLedgerViewResponse,
} from '@mybusiness/contracts';

import { formatMinorUnitsString } from '@/lib/format';
import { Button, Select, fieldControlClasses } from '@/components/ui';
import { parseLedgerQuery } from '@/lib/ledger/query';
import type { LedgerQuery, LedgerStatus } from '@/lib/ledger/query';
import type { LedgerDensity } from '@/components/ledger/ledger-preferences';

/** Límite del lote aceptado por el BFF (`BulkCategorizeDto`). */
export const MAX_BULK_ROWS = 500;

/** Cookie CSRF de doble envío (la única legible por el cliente). */
const CSRF_COOKIE = 'mb_csrf';

/**
 * Los estados se declaran aquí (no se importa el enum de `@mybusiness/contracts`)
 * porque el barrel arrastra `class-validator`/`class-transformer` al bundle del
 * cliente y rompe el render en servidor (`Reflect.getMetadata`). El tipo local
 * es la misma unión de literales que valida el contrato.
 */
export const STATUS_LABELS: Record<LedgerStatus, string> = {
  UNMATCHED: 'Sin conciliar',
  AUTO_MATCHED: 'Conciliado automático',
  MANUAL_MATCHED: 'Conciliado manual',
  NEEDS_REVIEW: 'Requiere revisión',
  REJECTED: 'Rechazado',
};

const STATUS_TONES: Record<LedgerStatus, string> = {
  UNMATCHED: 'border-border text-text-muted',
  AUTO_MATCHED: 'border-income/40 text-income',
  MANUAL_MATCHED: 'border-primary/40 text-primary',
  NEEDS_REVIEW: 'border-alert/40 text-alert',
  REJECTED: 'border-expense/40 text-expense',
};

export const STATUS_VALUES: readonly LedgerStatus[] = [
  'UNMATCHED',
  'AUTO_MATCHED',
  'MANUAL_MATCHED',
  'NEEDS_REVIEW',
  'REJECTED',
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Código de error estable del BFF; nunca se muestra el cuerpo remoto. */
export async function readErrorCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Respuesta sin JSON: se usa el código HTTP.
  }

  return `http_${String(response.status)}`;
}

export function errorCode(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : 'error';
}

/** Lee una cookie no httpOnly; `undefined` si no existe o está vacía. */
function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  const rawValue = match?.[1];

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}

/** Cabecera CSRF para mutaciones; vacía si la cookie aún no existe. */
function csrfHeaders(): Record<string, string> {
  const token = readCookie(CSRF_COOKIE);

  return token === undefined ? {} : { 'x-csrf-token': token };
}

/**
 * Mutación JSON contra el BFF. El cuerpo de respuesta es de confianza (mismo
 * origen y contrato validado en el servidor); cada llamador lo reinterpreta.
 */
export async function requestJson<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers:
      body === undefined ? csrfHeaders() : { 'content-type': 'application/json', ...csrfHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readErrorCode(response));
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Convierte la consulta persistida de una vista a la forma normalizada. */
export function viewToQuery(dto: LedgerQueryDto): LedgerQuery {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(dto)) {
    if (typeof value === 'string' || typeof value === 'number') {
      params.set(key, String(value));
    }
  }

  return parseLedgerQuery(params);
}

type AmountSign = 'negative' | 'positive' | 'zero';

function amountSign(amountMinor: string): AmountSign {
  try {
    const value = BigInt(amountMinor.trim());

    return value < 0n ? 'negative' : value > 0n ? 'positive' : 'zero';
  } catch {
    return 'zero';
  }
}

function formatAmount(row: LedgerRowResponse): string {
  try {
    return formatMinorUnitsString(row.amountMinor.trim().replace(/^-/, ''), row.isoCurrencyCode);
  } catch {
    return row.amountMinor;
  }
}

/** Importe con signo y color; el texto alternativo evita depender del color. */
export function AmountCell({ row }: { row: LedgerRowResponse }) {
  const sign = amountSign(row.amountMinor);
  const tone =
    sign === 'negative' ? 'text-expense' : sign === 'positive' ? 'text-income' : 'text-text';

  return (
    <span className={`tabular-nums font-medium ${tone}`}>
      <span aria-hidden="true">{sign === 'negative' ? '−' : sign === 'positive' ? '+' : ''}</span>
      {sign === 'zero' ? null : (
        <span className="sr-only">{sign === 'negative' ? 'Egreso de ' : 'Ingreso de '}</span>
      )}
      {formatAmount(row)}
    </span>
  );
}

/** Chip de conciliación: siempre lleva texto, nunca depende sólo del color. */
export function StatusChip({ status }: { status: LedgerStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_TONES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export interface LedgerFiltersProps {
  query: LedgerQuery;
  searchInput: string;
  isPending: boolean;
  density: LedgerDensity;
  viewsControl: ReactNode;
  onSearchChange: (value: string) => void;
  onFilterChange: (patch: Partial<LedgerQuery>) => void;
  onDensityChange: (density: LedgerDensity) => void;
  onClear: () => void;
  onExport: () => void;
}

export function LedgerFilters({
  query,
  searchInput,
  isPending,
  density,
  viewsControl,
  onSearchChange,
  onFilterChange,
  onDensityChange,
  onClear,
  onExport,
}: LedgerFiltersProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium text-text">
          Buscar
          <input
            type="search"
            value={searchInput}
            maxLength={200}
            placeholder="Descripción o comercio"
            aria-label="Buscar movimientos por descripción o comercio"
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            className={fieldControlClasses}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Desde
          <input
            type="date"
            value={query.from ?? ''}
            onChange={(event) => {
              onFilterChange({ from: event.target.value === '' ? undefined : event.target.value });
            }}
            className={fieldControlClasses}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Hasta
          <input
            type="date"
            value={query.to ?? ''}
            onChange={(event) => {
              onFilterChange({ to: event.target.value === '' ? undefined : event.target.value });
            }}
            className={fieldControlClasses}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Conciliación
          <Select
            value={query.reconciliationStatus ?? ''}
            onChange={(event) => {
              onFilterChange({
                reconciliationStatus: STATUS_VALUES.find((value) => value === event.target.value),
              });
            }}
          >
            <option value="">Todos</option>
            {STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </label>

        <Button variant="secondary" onClick={onClear}>
          Limpiar
        </Button>
        <Button variant="secondary" onClick={onExport}>
          Exportar CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {viewsControl}

        <div role="group" aria-label="Densidad de la tabla" className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">Densidad</span>
          <Button
            variant={density === 'comfortable' ? 'primary' : 'secondary'}
            aria-pressed={density === 'comfortable'}
            onClick={() => {
              onDensityChange('comfortable');
            }}
          >
            Cómoda
          </Button>
          <Button
            variant={density === 'compact' ? 'primary' : 'secondary'}
            aria-pressed={density === 'compact'}
            onClick={() => {
              onDensityChange('compact');
            }}
          >
            Compacta
          </Button>
        </div>

        {isPending ? (
          <span role="status" className="text-sm text-text-muted">
            Actualizando…
          </span>
        ) : null}
      </div>

      <p className="text-xs text-text-muted">
        Atajos: <kbd>j</kbd>/<kbd>k</kbd> para moverte entre filas, <kbd>Enter</kbd> para editar la
        categoría y <kbd>Escape</kbd> para salir.
      </p>
    </div>
  );
}

export interface SavedViewsControlProps {
  initialViews: SavedLedgerViewResponse[];
  currentQuery: LedgerQuery;
  onApply: (query: LedgerQuery) => void;
}

/** Selector y gestión de vistas guardadas; el estado es local al control. */
export function SavedViewsControl({ initialViews, currentQuery, onApply }: SavedViewsControlProps) {
  const [views, setViews] = useState<SavedLedgerViewResponse[]>(initialViews);
  const [activeId, setActiveId] = useState('');
  const [status, setStatus] = useState('');

  const selectView = useCallback(
    (viewId: string) => {
      setActiveId(viewId);

      const view = views.find((entry) => entry.id === viewId);

      if (view !== undefined) {
        onApply(viewToQuery(view.query));
      }
    },
    [onApply, views],
  );

  const saveView = useCallback(async () => {
    const name = window.prompt('Nombre de la vista');

    if (name === null) {
      return;
    }

    const trimmedName = name.trim();

    if (trimmedName.length === 0 || trimmedName.length > 100) {
      setStatus('El nombre de la vista debe tener entre 1 y 100 caracteres.');

      return;
    }

    try {
      const view = await requestJson<SavedLedgerViewResponse>('/api/ledger/saved-views', 'POST', {
        name: trimmedName,
        query: currentQuery,
      });

      setViews((previous) => [...previous, view]);
      setActiveId(view.id);
      setStatus(`Vista «${view.name}» guardada.`);
    } catch (cause) {
      setStatus(`No se pudo guardar la vista: ${errorCode(cause)}`);
    }
  }, [currentQuery]);

  const deleteView = useCallback(async () => {
    const view = views.find((entry) => entry.id === activeId);

    if (view === undefined || !window.confirm(`¿Eliminar la vista «${view.name}»?`)) {
      return;
    }

    try {
      await requestJson<void>(`/api/ledger/saved-views/${encodeURIComponent(view.id)}`, 'DELETE');
      setViews((previous) => previous.filter((entry) => entry.id !== view.id));
      setActiveId('');
      setStatus(`Vista «${view.name}» eliminada.`);
    } catch (cause) {
      setStatus(`No se pudo eliminar la vista: ${errorCode(cause)}`);
    }
  }, [activeId, views]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Vista guardada
        <Select
          value={activeId}
          aria-label="Vistas guardadas"
          onChange={(event) => {
            selectView(event.target.value);
          }}
        >
          <option value="">Ninguna</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </Select>
      </label>

      <Button
        variant="secondary"
        onClick={() => {
          void saveView();
        }}
      >
        Guardar vista
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          void deleteView();
        }}
        disabled={activeId === ''}
      >
        Eliminar vista
      </Button>
    </>
  );
}

export interface LedgerPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  isPending: boolean;
  onChange: (page: number) => void;
}

export function LedgerPagination({
  page,
  totalPages,
  total,
  isPending,
  onChange,
}: LedgerPaginationProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">
        Página {page} de {totalPages} · {total} movimientos
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onChange(Math.max(1, page - 1));
          }}
          disabled={page <= 1 || isPending}
          aria-label="Página anterior"
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onChange(Math.min(totalPages, page + 1));
          }}
          disabled={page >= totalPages || isPending}
          aria-label="Página siguiente"
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export interface LedgerBulkBarProps {
  selectedCount: number;
  category: string;
  isPending: boolean;
  overLimit: boolean;
  onCategoryChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function LedgerBulkBar({
  selectedCount,
  category,
  isPending,
  overLimit,
  onCategoryChange,
  onApply,
  onCancel,
}: LedgerBulkBarProps) {
  return (
    <div
      role="region"
      aria-label="Acciones masivas"
      className="fixed bottom-6 left-1/2 z-20 flex w-[min(48rem,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-raised p-4 shadow-lg"
    >
      <p className="text-sm font-medium text-text">
        {selectedCount} seleccionados
        {overLimit ? ` (máximo ${String(MAX_BULK_ROWS)})` : ''}
      </p>

      <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-text">
        Categoría
        <input
          type="text"
          value={category}
          maxLength={200}
          onChange={(event) => {
            onCategoryChange(event.target.value);
          }}
          className={fieldControlClasses}
        />
      </label>

      <Button
        onClick={onApply}
        disabled={isPending || overLimit || category.trim().length === 0}
        loading={isPending}
      >
        {isPending ? 'Aplicando…' : `Aplicar a ${String(selectedCount)}`}
      </Button>
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>

      {overLimit ? (
        <p role="alert" className="w-full text-sm text-expense">
          La selección supera el máximo de {MAX_BULK_ROWS} movimientos por lote.
        </p>
      ) : null}
    </div>
  );
}
