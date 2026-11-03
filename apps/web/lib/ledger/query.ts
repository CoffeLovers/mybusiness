/**
 * Tipos y utilidades de consulta del libro mayor, compartidos entre cliente y
 * servidor.
 *
 * El parseo nunca lanza: cualquier valor inválido cae al default para que un
 * enlace manipulado no rompa la página ni el BFF. La serialización respeta el
 * orden declarado de los campos para que las URLs sean estables (cacheables y
 * comparables en tests).
 */

/** Campos ordenables permitidos por el contrato del gateway. */
export type LedgerSortField = 'date' | 'amount' | 'name' | 'category' | 'status';
export type LedgerSortDir = 'asc' | 'desc';

/** Estado de conciliación derivado de `reconciliation_matches`. */
export type LedgerStatus =
  'UNMATCHED' | 'AUTO_MATCHED' | 'MANUAL_MATCHED' | 'NEEDS_REVIEW' | 'REJECTED';

export interface LedgerQuery {
  page: number;
  pageSize: number;
  sortBy: LedgerSortField;
  sortDir: LedgerSortDir;
  from?: string;
  to?: string;
  q?: string;
  category?: string;
  reconciliationStatus?: LedgerStatus;
  accountId?: string;
}

export const MIN_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const DEFAULT_LEDGER_QUERY: LedgerQuery = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: 'date',
  sortDir: 'desc',
};

const SORT_FIELDS: readonly LedgerSortField[] = ['date', 'amount', 'name', 'category', 'status'];

const SORT_DIRS: readonly LedgerSortDir[] = ['asc', 'desc'];

const RECONCILIATION_STATUSES: readonly LedgerStatus[] = [
  'UNMATCHED',
  'AUTO_MATCHED',
  'MANUAL_MATCHED',
  'NEEDS_REVIEW',
  'REJECTED',
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Longitud máxima de los filtros de texto libre (alineada con el contrato). */
const MAX_TEXT_LENGTH = 200;

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

/** Normaliza `searchParams` a un accesor de un único valor por clave. */
function readParam(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    const value = params.get(key);

    return value === null || value === '' ? undefined : value;
  }

  const value = params[key];

  if (Array.isArray(value)) {
    return value[0] === undefined || value[0] === '' ? undefined : value[0];
  }

  return value === undefined || value === '' ? undefined : value;
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) ? parsed : fallback;
}

/** `YYYY-MM-DD` con día y mes plausibles; se compara como texto ISO. */
function toIsoDate(value: string | undefined): string | undefined {
  if (value === undefined || !DATE_PATTERN.test(value)) {
    return undefined;
  }

  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== (month ?? 1) - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return value;
}

function toText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 || trimmed.length > MAX_TEXT_LENGTH ? undefined : trimmed;
}

/** Lee y valida `searchParams` (whitelists y rangos) sin lanzar. */
export function parseLedgerQuery(params: RawParams): LedgerQuery {
  const rawPage = toInt(readParam(params, 'page'), DEFAULT_LEDGER_QUERY.page);
  const rawPageSize = toInt(readParam(params, 'pageSize'), DEFAULT_LEDGER_QUERY.pageSize);

  const page = rawPage >= 1 ? rawPage : DEFAULT_LEDGER_QUERY.page;
  const pageSize =
    rawPageSize >= MIN_PAGE_SIZE && rawPageSize <= MAX_PAGE_SIZE
      ? rawPageSize
      : DEFAULT_LEDGER_QUERY.pageSize;

  const rawSortBy = readParam(params, 'sortBy');
  const sortBy = SORT_FIELDS.find((field) => field === rawSortBy) ?? DEFAULT_LEDGER_QUERY.sortBy;

  const rawSortDir = readParam(params, 'sortDir');
  const sortDir = SORT_DIRS.find((dir) => dir === rawSortDir) ?? DEFAULT_LEDGER_QUERY.sortDir;

  const rawFrom = toIsoDate(readParam(params, 'from'));
  const rawTo = toIsoDate(readParam(params, 'to'));

  // Rango invertido: se descarta para no enviar una consulta imposible.
  const rangeValid = rawFrom !== undefined && rawTo !== undefined ? rawFrom <= rawTo : true;
  const from = rangeValid ? rawFrom : undefined;
  const to = rangeValid ? rawTo : undefined;

  const rawStatus = readParam(params, 'reconciliationStatus');
  const reconciliationStatus = RECONCILIATION_STATUSES.find((status) => status === rawStatus);

  const query: LedgerQuery = { page, pageSize, sortBy, sortDir };

  if (from !== undefined) {
    query.from = from;
  }

  if (to !== undefined) {
    query.to = to;
  }

  const q = toText(readParam(params, 'q'));

  if (q !== undefined) {
    query.q = q;
  }

  const category = toText(readParam(params, 'category'));

  if (category !== undefined) {
    query.category = category;
  }

  if (reconciliationStatus !== undefined) {
    query.reconciliationStatus = reconciliationStatus;
  }

  const accountId = toText(readParam(params, 'accountId'));

  if (accountId !== undefined) {
    query.accountId = accountId;
  }

  return query;
}

/** Serializa sólo los campos no vacíos, en orden estable. */
export function ledgerQueryToSearchParams(query: LedgerQuery): URLSearchParams {
  const params = new URLSearchParams();

  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  params.set('sortBy', query.sortBy);
  params.set('sortDir', query.sortDir);

  if (query.from !== undefined && query.from !== '') {
    params.set('from', query.from);
  }

  if (query.to !== undefined && query.to !== '') {
    params.set('to', query.to);
  }

  if (query.q !== undefined && query.q !== '') {
    params.set('q', query.q);
  }

  if (query.category !== undefined && query.category !== '') {
    params.set('category', query.category);
  }

  if (query.reconciliationStatus !== undefined) {
    params.set('reconciliationStatus', query.reconciliationStatus);
  }

  if (query.accountId !== undefined && query.accountId !== '') {
    params.set('accountId', query.accountId);
  }

  return params;
}
