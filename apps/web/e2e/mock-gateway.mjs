/**
 * Gateway falso para los E2E del portal web.
 *
 * Implementa sólo los endpoints que consume el BFF durante las pruebas de
 * sesión, con estado en memoria para verificar la rotación de tokens.
 * Sin dependencias: `node:http` y nada más.
 */

import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = 3200;

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'OWNER',
  tenantId: '00000000-0000-0000-0000-000000000001',
};

const REFRESH_COOKIE = 'mybusiness_refresh_token';

/** Refresh tokens ya rotados: reutilizarlos debe fallar. */
const USED_REFRESH_TOKENS = new Set(['refresh-2']);

/** Envía una respuesta JSON. */
function sendJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  response.end(payload);
}

/** Respuesta de error con el código estable que espera el BFF. */
function sendError(response, status, message) {
  sendJson(response, status, { statusCode: status, message });
}

/** Lee y parsea el cuerpo JSON; `null` si está vacío o es inválido. */
async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Cabecera `Set-Cookie` con el refresh token del gateway. */
function refreshCookie(value) {
  return `${REFRESH_COOKIE}=${value}; Path=/api/v1/auth; HttpOnly`;
}

async function handleLogin(request, response) {
  const body = await readJson(request);

  if (body === null || typeof body.email !== 'string' || typeof body.password !== 'string') {
    sendError(response, 400, 'invalid_credentials_shape');
    return;
  }

  if (body.password !== 'correct-password') {
    sendError(response, 401, 'invalid_credentials');
    return;
  }

  sendJson(
    response,
    200,
    {
      accessToken: 'access-1',
      user: { ...USER, email: body.email },
    },
    { 'set-cookie': refreshCookie('refresh-1') },
  );
}

async function handleRefresh(request, response) {
  const body = await readJson(request);
  const refreshToken = body === null ? undefined : body.refreshToken;

  if (refreshToken === 'refresh-1') {
    USED_REFRESH_TOKENS.add('refresh-1');
    sendJson(
      response,
      200,
      {
        accessToken: 'access-2',
        user: { ...USER },
      },
      { 'set-cookie': refreshCookie('refresh-2') },
    );
    return;
  }

  if (typeof refreshToken === 'string' && USED_REFRESH_TOKENS.has(refreshToken)) {
    sendError(response, 401, 'refresh_token_reused');
    return;
  }

  sendError(response, 401, 'invalid_refresh_token');
}

function handleLogoutAll(request, response) {
  const authorization = request.headers.authorization ?? '';

  if (!/^Bearer access-[A-Za-z0-9._-]+$/.test(authorization)) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  sendJson(response, 200, { success: true, revoked: 2 });
}

function handleCashflowSummary(request, response, url) {
  const authorization = request.headers.authorization ?? '';

  if (!/^Bearer access-[A-Za-z0-9._-]+$/.test(authorization)) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const from = url.searchParams.get('from') || '2026-10-01';
  const to = url.searchParams.get('to') || '2026-10-30';
  const currency = url.searchParams.get('currency') || 'EUR';

  // Escenario de error simulado
  if (currency === 'ERROR' || from.includes('error')) {
    sendError(response, 500, 'Error interno del servicio de finanzas');
    return;
  }

  // Escenario de datos vacíos (empty state)
  if (currency === 'EMPTY' || from.includes('empty') || from === '2020-01-01') {
    sendJson(response, 200, {
      hasData: false,
      currency,
      availableCurrencies: ['EUR', 'USD'],
      period: { from, to },
      balanceMinor: null,
      incomeMinor: null,
      expenseMinor: null,
      burnRateMinor: null,
      runwayMonths: null,
      previousPeriod: null,
      series: [],
      categories: [],
    });
    return;
  }

  // Si el rango es mayor a 60 días (ej. 90 días o ytd), devolvemos valores acumulados distintos
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  const diffDays = Math.round((toTime - fromTime) / 86400000) + 1;

  if (diffDays > 60) {
    sendJson(response, 200, {
      hasData: true,
      currency,
      availableCurrencies: ['EUR', 'USD'],
      period: { from, to },
      balanceMinor: '4500000',
      incomeMinor: '3850000',
      expenseMinor: '2460000',
      burnRateMinor: '820000',
      runwayMonths: 5.5,
      previousPeriod: {
        incomeMinor: '3200000',
        expenseMinor: '2100000',
      },
      series: [
        { bucketStart: `${from.slice(0, 7)}-01`, incomeMinor: '1850000', expenseMinor: '1200000' },
        { bucketStart: `${to.slice(0, 7)}-01`, incomeMinor: '2000000', expenseMinor: '1260000' },
      ],
      categories: [
        { category: 'Servicios en la nube', amountMinor: '1350000', share: 0.5488 },
        { category: 'Nómina', amountMinor: '750000', share: 0.3049 },
        { category: 'Oficina', amountMinor: '360000', share: 0.1463 },
      ],
    });
    return;
  }

  // Respuesta estándar para 30 días
  sendJson(response, 200, {
    hasData: true,
    currency,
    availableCurrencies: ['EUR', 'USD'],
    period: { from, to },
    balanceMinor: '4500000',
    incomeMinor: '1250000',
    expenseMinor: '820000',
    burnRateMinor: '820000',
    runwayMonths: 5.5,
    previousPeriod: {
      incomeMinor: '1100000',
      expenseMinor: '790000',
    },
    series: [
      { bucketStart: from, incomeMinor: '500000', expenseMinor: '300000' },
      { bucketStart: to, incomeMinor: '750000', expenseMinor: '520000' },
    ],
    categories: [
      { category: 'Servicios en la nube', amountMinor: '450000', share: 0.5488 },
      { category: 'Nómina', amountMinor: '250000', share: 0.3049 },
      { category: 'Oficina', amountMinor: '120000', share: 0.1463 },
    ],
  });
}

/* ------------------------------------------------------------------------- */
/* Libro mayor                                                               */
/* ------------------------------------------------------------------------- */

const LEDGER_TOTAL_ROWS = 50_000;
const LEDGER_EXPORT_LIMIT = 50_000;
const LEDGER_MAX_PAGE_SIZE = 200;
const LEDGER_MAX_BULK_ROWS = 500;

const LEDGER_CATEGORIES = [
  'Nómina',
  'Oficina',
  'Servicios en la nube',
  'Marketing',
  'Impuestos',
  'Viajes',
  null,
];

const LEDGER_STATUSES = ['UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'NEEDS_REVIEW', 'REJECTED'];

const LEDGER_CURRENCIES = ['EUR', 'EUR', 'EUR', 'USD'];

const LEDGER_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

/** PRNG determinista (mulberry32): los datos son idénticos entre ejecuciones. */
function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID determinista con forma válida (el BFF valida la forma del id). */
function ledgerUuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/** 50.000 filas generadas una sola vez al arrancar el mock. */
const LEDGER_ROWS = (() => {
  const random = createRandom(0x5eed1234);
  const rows = [];
  const baseDate = Date.UTC(2025, 0, 1);

  for (let index = 0; index < LEDGER_TOTAL_ROWS; index += 1) {
    const padded = String(index + 1).padStart(5, '0');
    const dayOffset = Math.floor(random() * 730);
    const date = new Date(baseDate + dayOffset * 86_400_000).toISOString().slice(0, 10);
    const category = LEDGER_CATEGORIES[Math.floor(random() * LEDGER_CATEGORIES.length)];
    const status = LEDGER_STATUSES[Math.floor(random() * LEDGER_STATUSES.length)];
    const currency = LEDGER_CURRENCIES[Math.floor(random() * LEDGER_CURRENCIES.length)];
    // Importes en unidad menor como `string`: el dominio nunca usa floats.
    const magnitude = BigInt(Math.floor(random() * 5_000_00));
    const amountMinor = random() < 0.35 ? -magnitude : magnitude;

    rows.push({
      id: ledgerUuid(index + 1),
      date,
      name: `Movimiento ${padded}`,
      merchantName: random() < 0.6 ? `Comercio ${padded}` : null,
      category,
      notes: null,
      amountMinor: amountMinor.toString(),
      isoCurrencyCode: currency,
      accountId: LEDGER_ACCOUNT_ID,
      accountName: 'Cuenta principal',
      reconciliationStatus: status,
      evidence: null,
      updatedAt: `${date}T09:00:00.000Z`,
    });
  }

  return rows;
})();

/** Índice por id para mutaciones sin recorrer las 50.000 filas. */
const LEDGER_BY_ID = new Map(LEDGER_ROWS.map((row) => [row.id, row]));

/** Vistas guardadas en memoria; se reinician con el proceso del mock. */
const SAVED_VIEWS = [];
let savedViewSequence = 0;

function isAuthorized(request) {
  const authorization = request.headers.authorization ?? '';

  return /^Bearer access-[A-Za-z0-9._-]+$/.test(authorization);
}

/** Normaliza la consulta del libro mayor con los mismos límites del contrato. */
function parseLedgerFilters(url) {
  const search = url.searchParams;
  const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1);
  const rawPageSize = Number.parseInt(search.get('pageSize') ?? '50', 10) || 50;

  return {
    page,
    pageSize: Math.min(LEDGER_MAX_PAGE_SIZE, Math.max(10, rawPageSize)),
    sortBy: search.get('sortBy') ?? 'date',
    sortDir: search.get('sortDir') === 'asc' ? 'asc' : 'desc',
    q: (search.get('q') ?? '').trim().toLowerCase(),
    category: search.get('category'),
    reconciliationStatus: search.get('reconciliationStatus'),
    from: search.get('from'),
    to: search.get('to'),
  };
}

function filterLedgerRows(filters) {
  return LEDGER_ROWS.filter((row) => {
    if (filters.q.length > 0) {
      const haystack = `${row.name} ${row.merchantName ?? ''}`.toLowerCase();

      if (!haystack.includes(filters.q)) {
        return false;
      }
    }

    if (filters.category !== null && row.category !== filters.category) {
      return false;
    }

    if (
      filters.reconciliationStatus !== null &&
      row.reconciliationStatus !== filters.reconciliationStatus
    ) {
      return false;
    }

    if (filters.from !== null && row.date < filters.from) {
      return false;
    }

    if (filters.to !== null && row.date > filters.to) {
      return false;
    }

    return true;
  });
}

const LEDGER_SORT_FIELDS = new Set(['date', 'amount', 'name', 'category', 'status']);

function compareLedgerRows(left, right, field) {
  if (field === 'amount') {
    const leftAmount = BigInt(left.amountMinor);
    const rightAmount = BigInt(right.amountMinor);

    return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
  }

  if (field === 'status') {
    return left.reconciliationStatus.localeCompare(right.reconciliationStatus);
  }

  if (field === 'category') {
    return (left.category ?? '').localeCompare(right.category ?? '');
  }

  return String(left[field]).localeCompare(String(right[field]));
}

function sortLedgerRows(rows, sortBy, sortDir) {
  const field = LEDGER_SORT_FIELDS.has(sortBy) ? sortBy : 'date';
  const direction = sortDir === 'asc' ? 1 : -1;

  return rows.slice().sort((left, right) => compareLedgerRows(left, right, field) * direction);
}

function handleLedgerList(request, response, url) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const filters = parseLedgerFilters(url);
  const filtered = filterLedgerRows(filters);
  const sorted = sortLedgerRows(filtered, filters.sortBy, filters.sortDir);
  const start = (filters.page - 1) * filters.pageSize;
  const rows = sorted.slice(start, start + filters.pageSize);

  sendJson(response, 200, {
    rows,
    total: filtered.length,
    page: filters.page,
    pageSize: filters.pageSize,
    hasMore: start + rows.length < filtered.length,
  });
}

async function handleLedgerUpdate(request, response, id) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const body = await readJson(request);
  // El cliente sólo envía `category`/`notes`; para forzar el conflicto se
  // acepta la clave `__fail` o un valor que la contenga.
  const containsFailFlag =
    typeof body === 'object' &&
    body !== null &&
    (Object.hasOwn(body, '__fail') ||
      Object.values(body).some((value) => typeof value === 'string' && value.includes('__fail')));

  // Escenarios de conflicto: id terminado en `-fail` (llamada directa) o un
  // cuerpo con `__fail` (la UI sólo envía `category`, así que se usa ese valor).
  if (id.endsWith('-fail') || containsFailFlag) {
    sendError(response, 409, 'conflict');

    return;
  }

  const row = LEDGER_BY_ID.get(id);

  if (row === undefined) {
    sendError(response, 404, 'not_found');

    return;
  }

  if (typeof body === 'object' && body !== null) {
    if (typeof body.category === 'string') {
      row.category = body.category.length === 0 ? null : body.category;
    }

    if (typeof body.notes === 'string') {
      row.notes = body.notes.length === 0 ? null : body.notes;
    }
  }

  row.updatedAt = new Date().toISOString();
  sendJson(response, 200, row);
}

async function handleLedgerBulkCategorize(request, response) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const body = await readJson(request);

  if (typeof body !== 'object' || body === null || !Array.isArray(body.ids)) {
    sendError(response, 400, 'invalid_payload');

    return;
  }

  if (body.ids.length > LEDGER_MAX_BULK_ROWS) {
    sendError(response, 400, 'too_many_rows');

    return;
  }

  if (body.ids.length === 0 || typeof body.category !== 'string') {
    sendError(response, 400, 'invalid_payload');

    return;
  }

  const updatedAt = new Date().toISOString();
  let updated = 0;

  for (const id of body.ids) {
    const row = typeof id === 'string' ? LEDGER_BY_ID.get(id) : undefined;

    if (row !== undefined) {
      row.category = body.category;
      row.updatedAt = updatedAt;
      updated += 1;
    }
  }

  sendJson(response, 200, { updated, requested: body.ids.length });
}

/** Escapa un campo CSV (comillas, comas y saltos de línea). */
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);

  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function handleLedgerExport(request, response, url) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const filters = parseLedgerFilters(url);
  const rows = sortLedgerRows(filterLedgerRows(filters), filters.sortBy, filters.sortDir).slice(
    0,
    LEDGER_EXPORT_LIMIT,
  );

  const lines = ['\uFEFFfecha,descripcion,comercio,importe,moneda,categoria,conciliacion,cuenta'];

  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.name,
        row.merchantName,
        row.amountMinor,
        row.isoCurrencyCode,
        row.category,
        row.reconciliationStatus,
        row.accountName,
      ]
        .map(csvField)
        .join(','),
    );
  }

  const payload = `${lines.join('\n')}\n`;

  response.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'content-disposition': 'attachment; filename="libro-mayor.csv"',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function handleSavedViewsList(request, response) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  sendJson(response, 200, SAVED_VIEWS);
}

async function handleSavedViewCreate(request, response) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const body = await readJson(request);

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof body.name !== 'string' ||
    body.name.length === 0
  ) {
    sendError(response, 400, 'invalid_payload');

    return;
  }

  savedViewSequence += 1;
  const now = new Date().toISOString();
  const view = {
    id: ledgerUuid(900_000 + savedViewSequence),
    name: body.name,
    query: typeof body.query === 'object' && body.query !== null ? body.query : {},
    createdAt: now,
    updatedAt: now,
  };

  SAVED_VIEWS.push(view);
  sendJson(response, 201, view);
}

function handleSavedViewDelete(request, response, id) {
  if (!isAuthorized(request)) {
    sendError(response, 401, 'unauthorized');

    return;
  }

  const index = SAVED_VIEWS.findIndex((view) => view.id === id);

  if (index >= 0) {
    SAVED_VIEWS.splice(index, 1);
  }

  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

const server = createServer((request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (method === 'GET' && path === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (method === 'POST' && path === '/api/v1/auth/login') {
    void handleLogin(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/auth/refresh') {
    void handleRefresh(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/auth/logout') {
    sendJson(response, 200, { success: true });
    return;
  }

  if (method === 'POST' && path === '/api/v1/auth/logout-all') {
    handleLogoutAll(request, response);
    return;
  }

  if (method === 'GET' && path === '/api/v1/finance/cashflow/summary') {
    handleCashflowSummary(request, response, url);
    return;
  }

  if (method === 'GET' && path === '/api/v1/finance/ledger') {
    handleLedgerList(request, response, url);
    return;
  }

  if (method === 'GET' && path === '/api/v1/finance/ledger/export.csv') {
    handleLedgerExport(request, response, url);
    return;
  }

  if (method === 'POST' && path === '/api/v1/finance/ledger/bulk-categorize') {
    void handleLedgerBulkCategorize(request, response);
    return;
  }

  if (path === '/api/v1/finance/ledger/saved-views') {
    if (method === 'GET') {
      handleSavedViewsList(request, response);
      return;
    }

    if (method === 'POST') {
      void handleSavedViewCreate(request, response);
      return;
    }
  }

  const savedViewMatch = /^\/api\/v1\/finance\/ledger\/saved-views\/([^/]+)$/.exec(path);

  if (method === 'DELETE' && savedViewMatch !== null) {
    handleSavedViewDelete(request, response, decodeURIComponent(savedViewMatch[1]));
    return;
  }

  const ledgerRowMatch = /^\/api\/v1\/finance\/ledger\/([^/]+)$/.exec(path);

  if (method === 'PATCH' && ledgerRowMatch !== null) {
    void handleLedgerUpdate(request, response, decodeURIComponent(ledgerRowMatch[1]));
    return;
  }

  sendError(response, 404, 'not_found');
});

server.listen(PORT, HOST);
