'use client';

/**
 * Libro mayor interactivo.
 *
 * - TanStack Table aporta sólo el modelo de columnas: paginación y orden son
 *   manuales porque el filtrado y el recorte ocurren en el gateway.
 * - El cuerpo se virtualiza con TanStack Virtual sobre un contenedor de altura
 *   fija (`max-h-[70vh]`), con filas posicionadas por `translateY`.
 * - Cada mutación pasa por el BFF con el token CSRF de doble envío. La edición
 *   inline es optimista con rollback explícito y anuncio por `aria-live`.
 * - Los controles y las utilidades de petición viven en `ledger-filters.tsx`.
 */

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type {
  LedgerPageResponse,
  LedgerRowResponse,
  SavedLedgerViewResponse,
} from '@mybusiness/contracts';

import { InlineEditCell } from '@/components/ledger/inline-edit-cell';
import { LEDGER_ROW_HEIGHT, useLedgerDensity } from '@/components/ledger/ledger-preferences';
import type { LedgerDensity } from '@/components/ledger/ledger-preferences';
import {
  AmountCell,
  LedgerBulkBar,
  LedgerFilters,
  LedgerPagination,
  MAX_BULK_ROWS,
  SavedViewsControl,
  StatusChip,
  errorCode,
  isRecord,
  readErrorCode,
  requestJson,
} from '@/components/ledger/ledger-filters';
import { DEFAULT_LEDGER_QUERY, ledgerQueryToSearchParams } from '@/lib/ledger/query';
import type { LedgerQuery, LedgerSortField } from '@/lib/ledger/query';

export interface LedgerViewProps {
  initialPage: LedgerPageResponse;
  initialQuery: LedgerQuery;
  savedViews: SavedLedgerViewResponse[];
  initialError?: boolean;
}

type EditableField = 'category' | 'notes';

const PAGE_PATH = '/libro-mayor';
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Anchos responsive por columna. En móvil sólo quedan las columnas
 * prioritarias (fecha, descripción, importe y conciliación); las demás se
 * ocultan con `hidden md:table-cell` en cabecera y celdas.
 */
const COLUMN_CLASSES: Record<string, { th: string; td: string }> = {
  select: { th: 'w-11', td: 'w-11' },
  date: { th: 'w-20 text-left md:w-[104px]', td: 'w-20 md:w-[104px]' },
  name: { th: 'text-left', td: '' },
  category: { th: 'hidden md:table-cell md:w-[176px] text-left', td: 'hidden md:table-cell' },
  amount: {
    th: 'w-24 text-right tabular-nums md:w-[132px]',
    td: 'w-24 text-right tabular-nums md:w-[132px]',
  },
  currency: { th: 'hidden md:table-cell md:w-[76px] text-left', td: 'hidden md:table-cell' },
  status: { th: 'w-[7.5rem] text-left md:w-[180px]', td: 'w-[7.5rem] md:w-[180px]' },
  evidence: { th: 'hidden md:table-cell md:w-[150px] text-left', td: 'hidden md:table-cell' },
  notes: { th: 'hidden md:table-cell md:w-[220px] text-left', td: 'hidden md:table-cell' },
};

/** Rellena la clase de la columna (o vacía si aún no está mapeada). */
function columnClass(columnId: string, part: 'th' | 'td'): string {
  return COLUMN_CLASSES[columnId]?.[part] ?? '';
}

/** Columnas ordenables: `id` de columna → campo del contrato. */
const SORTABLE_COLUMNS: Record<string, LedgerSortField> = {
  date: 'date',
  name: 'name',
  category: 'category',
  amount: 'amount',
  status: 'status',
};

const CHECKBOX_CLASS =
  'h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const columnHelper = createColumnHelper<LedgerRowResponse>();

/** Guarda mínima de la página: las filas se renderizan, no se confía a ciegas. */
function parseLedgerPage(value: unknown): LedgerPageResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return null;
  }

  const { total, page, pageSize, hasMore } = value;

  return typeof total === 'number' &&
    typeof page === 'number' &&
    typeof pageSize === 'number' &&
    typeof hasMore === 'boolean'
    ? (value as unknown as LedgerPageResponse)
    : null;
}

function parseLedgerRow(value: unknown): LedgerRowResponse | null {
  return isRecord(value) && typeof value.id === 'string' && typeof value.updatedAt === 'string'
    ? (value as unknown as LedgerRowResponse)
    : null;
}

/** `YYYY-MM-DD` a `dd/mm/aaaa` sin reinterpretar la zona horaria. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('T')[0]?.split('-') ?? [];

  return year === undefined || month === undefined || day === undefined
    ? isoDate
    : `${day}/${month}/${year}`;
}

function SortHeader({
  label,
  field,
  activeField,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  field: LedgerSortField;
  activeField: LedgerSortField;
  dir: 'asc' | 'desc';
  onSort: (field: LedgerSortField) => void;
  align?: 'left' | 'right';
}) {
  const isActive = activeField === field;
  const direction = isActive ? (dir === 'asc' ? ' (ascendente)' : ' (descendente)') : '';

  return (
    <button
      type="button"
      onClick={() => {
        onSort(field);
      }}
      aria-label={`Ordenar por ${label}${direction}`}
      className={`flex items-center gap-1 rounded-sm text-xs font-semibold tracking-wide text-text-muted uppercase hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        align === 'right' ? 'ml-auto justify-end text-right' : 'text-left'
      }`}
    >
      {label}
      <span aria-hidden="true">{isActive ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

/** Aplica un valor a un único campo editable conservando el tipo de la fila. */
function replaceField(
  row: LedgerRowResponse,
  field: EditableField,
  value: string | null,
): LedgerRowResponse {
  return field === 'category' ? { ...row, category: value } : { ...row, notes: value };
}

export function LedgerView({
  initialPage,
  initialQuery,
  savedViews,
  initialError = false,
}: LedgerViewProps) {
  const [query, setQuery] = useState<LedgerQuery>(initialQuery);
  const [rows, setRows] = useState<LedgerRowResponse[]>(initialPage.rows);
  const [total, setTotal] = useState(initialPage.total);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [searchInput, setSearchInput] = useState(initialQuery.q ?? '');
  const [reloadToken, setReloadToken] = useState(0);
  const { density, setDensity } = useLedgerDensity();

  const rowsRef = useRef<LedgerRowResponse[]>(rows);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const focusedRowIndexRef = useRef<number | null>(null);
  const didMountRef = useRef(false);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const params = useMemo(() => ledgerQueryToSearchParams(query).toString(), [query]);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkOpen(false);
    setBulkCategory('');
  }, []);

  // Sincroniza el buscador cuando la consulta cambia por otra vía (vista, limpiar).
  useEffect(() => {
    setSearchInput(query.q ?? '');
  }, [query.q]);

  // Búsqueda con debounce: cada tecla no dispara una petición.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput.trim();

      setQuery((previous) => {
        if ((previous.q ?? '') === next) {
          return previous;
        }

        return { ...previous, q: next.length === 0 ? undefined : next, page: 1 };
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [searchInput]);

  // Recarga server-side al cambiar la consulta (o tras una acción masiva).
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;

      return;
    }

    const controller = new AbortController();
    setIsPending(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const response = await fetch(`/api/ledger?${params}`, {
          signal: controller.signal,
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(await readErrorCode(response));
        }

        const page = parseLedgerPage(await response.json());

        if (page === null) {
          throw new Error('invalid_response');
        }

        setRows(page.rows);
        setTotal(page.total);
        clearSelection();

        window.history.replaceState(null, '', `${PAGE_PATH}?${params}`);
      } catch (cause) {
        if (controller.signal.aborted) {
          return;
        }

        setErrorMessage(errorCode(cause));
      } finally {
        if (!controller.signal.aborted) {
          setIsPending(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [params, reloadToken, clearSelection]);

  useEffect(() => {
    if (headerCheckboxRef.current !== null) {
      headerCheckboxRef.current.indeterminate = selectedIds.size > 0 && !allSelected;
    }
  }, [selectedIds, allSelected]);

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
    setBulkOpen(true);
  }, []);

  const toggleAll = useCallback(() => {
    const currentRows = rowsRef.current;
    const all = currentRows.length > 0 && currentRows.every((row) => selectedIds.has(row.id));

    setSelectedIds(all ? new Set<string>() : new Set(currentRows.map((row) => row.id)));
    setBulkOpen(!all);
  }, [selectedIds]);

  const toggleSort = useCallback((field: LedgerSortField) => {
    setQuery((previous) =>
      previous.sortBy === field
        ? { ...previous, sortDir: previous.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...previous, sortBy: field, sortDir: 'asc', page: 1 },
    );
  }, []);

  const saveField = useCallback(
    async (id: string, field: EditableField, next: string): Promise<void> => {
      const current = rowsRef.current.find((row) => row.id === id);
      const previousValue =
        current === undefined ? null : field === 'category' ? current.category : current.notes;

      setRows((previous) =>
        previous.map((row) =>
          row.id === id ? replaceField(row, field, next.length === 0 ? null : next) : row,
        ),
      );

      try {
        const updated = parseLedgerRow(
          await requestJson<unknown>(`/api/ledger/${encodeURIComponent(id)}`, 'PATCH', {
            [field]: next,
          }),
        );

        if (updated !== null) {
          setRows((previous) => previous.map((row) => (row.id === id ? updated : row)));
        }

        setAnnouncement('Cambio guardado.');
      } catch (cause) {
        const code = errorCode(cause);

        setRows((previous) =>
          previous.map((row) => (row.id === id ? replaceField(row, field, previousValue) : row)),
        );
        setAnnouncement(`No se pudo guardar: ${code}`);

        throw new Error(code);
      }
    },
    [],
  );

  const applyBulk = useCallback(async () => {
    const ids = [...selectedIds];
    const category = bulkCategory.trim();

    if (ids.length === 0 || ids.length > MAX_BULK_ROWS) {
      setAnnouncement(`Selecciona entre 1 y ${String(MAX_BULK_ROWS)} movimientos.`);

      return;
    }

    if (category.length === 0) {
      setAnnouncement('Escribe una categoría antes de aplicar.');

      return;
    }

    if (
      !window.confirm(`¿Aplicar la categoría «${category}» a ${String(ids.length)} movimientos?`)
    ) {
      return;
    }

    setIsBulkPending(true);

    try {
      const result = await requestJson<{ updated?: number }>(
        '/api/ledger/bulk-categorize',
        'POST',
        { ids, category },
      );

      clearSelection();
      setAnnouncement(`Categoría aplicada a ${String(result.updated ?? ids.length)} movimientos.`);
      setReloadToken((token) => token + 1);
    } catch (cause) {
      setAnnouncement(`No se pudo aplicar la categoría: ${errorCode(cause)}`);
    } finally {
      setIsBulkPending(false);
    }
  }, [bulkCategory, clearSelection, selectedIds]);

  const updateFilter = useCallback((patch: Partial<LedgerQuery>) => {
    setQuery((previous) => ({ ...previous, ...patch, page: 1 }));
  }, []);

  const columns = useMemo(() => {
    function sortHeaderFor(label: string, field: LedgerSortField, align?: 'left' | 'right') {
      function SortableHeader() {
        return (
          <SortHeader
            label={label}
            field={field}
            activeField={query.sortBy}
            dir={query.sortDir}
            onSort={toggleSort}
            align={align}
          />
        );
      }

      SortableHeader.displayName = `SortHeader(${label})`;

      return SortableHeader;
    }

    return [
      columnHelper.display({
        id: 'select',
        size: 44,
        header: () => (
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Seleccionar todas las filas de la página"
            className={CHECKBOX_CLASS}
          />
        ),
        cell: (info) => (
          <input
            type="checkbox"
            checked={selectedIds.has(info.row.original.id)}
            onChange={() => {
              toggleRow(info.row.original.id);
            }}
            aria-label={`Seleccionar ${info.row.original.name} del ${formatDate(info.row.original.date)}`}
            className={CHECKBOX_CLASS}
          />
        ),
      }),
      columnHelper.accessor('date', {
        id: 'date',
        size: 104,
        header: sortHeaderFor('Fecha', 'date'),
        cell: (info) => <time dateTime={info.getValue()}>{formatDate(info.getValue())}</time>,
      }),
      columnHelper.accessor('name', {
        id: 'name',
        size: 240,
        header: sortHeaderFor('Descripción', 'name'),
        cell: (info) => (
          <div className="flex flex-col">
            <span className="truncate font-medium text-text">{info.row.original.name}</span>
            {info.row.original.merchantName === null ? null : (
              <span className="truncate text-xs text-text-muted">
                {info.row.original.merchantName}
              </span>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('category', {
        id: 'category',
        size: 176,
        header: sortHeaderFor('Categoría', 'category'),
        cell: (info) => (
          <InlineEditCell
            value={info.row.original.category ?? ''}
            label={`Categoría de ${info.row.original.name}`}
            maxLength={200}
            field="category"
            onSave={(next) => saveField(info.row.original.id, 'category', next)}
          />
        ),
      }),
      columnHelper.accessor('amountMinor', {
        id: 'amount',
        size: 132,
        header: sortHeaderFor('Importe', 'amount', 'right'),
        cell: (info) => <AmountCell row={info.row.original} />,
      }),
      columnHelper.accessor('isoCurrencyCode', {
        id: 'currency',
        size: 76,
        header: () => 'Moneda',
        cell: (info) => <span className="text-text-muted">{info.getValue()}</span>,
      }),
      columnHelper.accessor('reconciliationStatus', {
        id: 'status',
        size: 180,
        header: sortHeaderFor('Conciliación', 'status'),
        cell: (info) => <StatusChip status={info.getValue()} />,
      }),
      columnHelper.display({
        id: 'evidence',
        size: 150,
        header: () => 'Evidencia',
        cell: (info) => {
          const evidence = info.row.original.evidence;

          if (evidence === null) {
            return <span className="text-xs text-text-muted">Sin evidencia</span>;
          }

          return (
            <a
              href={`/documentos/${encodeURIComponent(evidence.documentId)}`}
              title={evidence.documentName}
              className="block truncate rounded-sm text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {evidence.documentName}
            </a>
          );
        },
      }),
      columnHelper.accessor('notes', {
        id: 'notes',
        size: 220,
        header: () => 'Notas',
        cell: (info) => (
          <InlineEditCell
            value={info.row.original.notes ?? ''}
            label={`Notas de ${info.row.original.name}`}
            maxLength={1000}
            multiline
            field="notes"
            onSave={(next) => saveField(info.row.original.id, 'notes', next)}
          />
        ),
      }),
    ];
  }, [
    allSelected,
    query.sortBy,
    query.sortDir,
    saveField,
    selectedIds,
    toggleAll,
    toggleRow,
    toggleSort,
  ]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const tableRows = table.getRowModel().rows;
  const rowHeight = LEDGER_ROW_HEIGHT[density];
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Al cambiar la densidad las mediciones previas dejan de ser válidas.
  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  /** Conmuta la densidad conservando la selección, los filtros y el scroll. */
  const changeDensity = useCallback(
    (next: LedgerDensity) => {
      if (next === density) {
        return;
      }

      const node = scrollRef.current;
      const scrollTop = node?.scrollTop ?? 0;

      setDensity(next);

      window.requestAnimationFrame(() => {
        const current = scrollRef.current;

        if (current !== null) {
          current.scrollTop = scrollTop;
        }

        virtualizer.measure();

        // Segunda pasada: el virtualizador puede recalcular alturas tras medir.
        window.requestAnimationFrame(() => {
          const restored = scrollRef.current;

          if (restored !== null) {
            restored.scrollTop = scrollTop;
          }
        });
      });
    },
    [density, setDensity, virtualizer],
  );

  /** Enfoca una fila virtualizada, desplazándola a la vista si hace falta. */
  const focusRow = useCallback(
    (index: number) => {
      if (index < 0 || index >= tableRows.length) {
        return;
      }

      virtualizer.scrollToIndex(index, { align: 'auto' });

      window.requestAnimationFrame(() => {
        const element = rowRefs.current.get(index);

        if (element !== undefined) {
          element.focus();
          focusedRowIndexRef.current = index;
        }
      });
    },
    [tableRows.length, virtualizer],
  );

  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const tag = target.tagName;

      if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const current = focusedRowIndexRef.current;
        const next = current === null ? 0 : current + (event.key === 'j' ? 1 : -1);

        focusRow(next);

        return;
      }

      if (event.key === 'Enter') {
        if (target instanceof HTMLTableRowElement) {
          const editable = target.querySelector<HTMLButtonElement>(
            'button[data-editable="category"]',
          );

          if (editable !== null) {
            event.preventDefault();
            editable.click();
          }
        }

        return;
      }

      if (event.key === 'Escape') {
        const row = target.closest('tr');

        if (row !== null) {
          (document.activeElement as HTMLElement | null)?.blur();
          focusedRowIndexRef.current = null;
        }
      }
    },
    [focusRow],
  );

  const virtualRows = virtualizer.getVirtualItems();
  const selectedCount = selectedIds.size;
  const overLimit = selectedCount > MAX_BULK_ROWS;

  return (
    <section
      className={`flex flex-col gap-4 ${selectedCount > 0 ? 'pb-28' : ''}`}
      aria-busy={isPending}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {initialError || errorMessage !== null ? (
        <p
          role="alert"
          className="rounded-lg border border-expense/30 bg-expense/5 px-4 py-3 text-sm text-expense"
        >
          {initialError
            ? 'No se pudo cargar el libro mayor. Vuelve a intentarlo en unos segundos.'
            : `No se pudieron cargar los movimientos (${errorMessage ?? 'error'}).`}
        </p>
      ) : null}

      <LedgerFilters
        query={query}
        searchInput={searchInput}
        isPending={isPending}
        density={density}
        viewsControl={
          <SavedViewsControl initialViews={savedViews} currentQuery={query} onApply={setQuery} />
        }
        onSearchChange={setSearchInput}
        onFilterChange={updateFilter}
        onDensityChange={changeDensity}
        onClear={() => {
          setQuery(DEFAULT_LEDGER_QUERY);
        }}
        onExport={() => {
          window.location.assign(`/api/ledger/export?${params}`);
        }}
      />

      <div
        ref={scrollRef}
        data-testid="ledger-scroll"
        onKeyDown={handleTableKeyDown}
        className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-surface"
      >
        <table className="w-full table-fixed border-collapse text-sm" aria-rowcount={total}>
          <caption className="sr-only">
            Movimientos del libro mayor. Usa las cabeceras para ordenar y las celdas de categoría y
            notas para editar.
          </caption>
          <thead className="sticky top-0 z-10 bg-surface-raised">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const field = SORTABLE_COLUMNS[header.column.id];

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      data-column={header.column.id}
                      aria-sort={
                        field === undefined
                          ? undefined
                          : query.sortBy === field
                            ? query.sortDir === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                      }
                      className={`border-b border-border px-2 py-2 align-middle ${columnClass(header.column.id, 'th')}`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={{ height: `${String(virtualizer.getTotalSize())}px`, position: 'relative' }}
          >
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-text-muted">
                  No hay movimientos para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              virtualRows.map((virtualRow) => {
                const tableRow = tableRows[virtualRow.index];

                if (tableRow === undefined) {
                  return null;
                }

                return (
                  <tr
                    key={tableRow.id}
                    ref={(element) => {
                      if (element === null) {
                        rowRefs.current.delete(virtualRow.index);
                      } else {
                        rowRefs.current.set(virtualRow.index, element);
                      }
                    }}
                    tabIndex={-1}
                    data-row-index={virtualRow.index}
                    aria-selected={selectedIds.has(tableRow.original.id)}
                    aria-rowindex={virtualRow.index + 2}
                    onFocus={() => {
                      focusedRowIndexRef.current = virtualRow.index;
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      display: 'table',
                      tableLayout: 'fixed',
                      width: '100%',
                      height: `${String(virtualRow.size)}px`,
                      transform: `translateY(${String(virtualRow.start)}px)`,
                    }}
                    className="border-b border-border/60 hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  >
                    {tableRow.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        data-column={cell.column.id}
                        className={`overflow-hidden px-2 align-middle ${density === 'compact' ? 'py-0.5' : 'py-2'} ${columnClass(cell.column.id, 'td')}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <LedgerPagination
        page={query.page}
        totalPages={totalPages}
        total={total}
        isPending={isPending}
        onChange={(page) => {
          setQuery((previous) => ({ ...previous, page }));
        }}
      />

      {bulkOpen && selectedCount > 0 ? (
        <LedgerBulkBar
          selectedCount={selectedCount}
          category={bulkCategory}
          isPending={isBulkPending}
          overLimit={overLimit}
          onCategoryChange={setBulkCategory}
          onApply={() => {
            void applyBulk();
          }}
          onCancel={clearSelection}
        />
      ) : null}
    </section>
  );
}
