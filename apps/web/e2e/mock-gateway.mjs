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

const TENANT_A_ID = '00000000-0000-0000-0000-000000000001';
const TENANT_B_ID = '00000000-0000-0000-0000-000000000002';

const USERS = {
  [TENANT_A_ID]: {
    id: 'u1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'OWNER',
    tenantId: TENANT_A_ID,
  },
  [TENANT_B_ID]: {
    id: 'u2',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: 'Smith',
    role: 'OWNER',
    tenantId: TENANT_B_ID,
  },
};

const USER = USERS[TENANT_A_ID];

/** Deriva el tenant ID a partir del token de autorización */
function getTenantIdFromRequest(request) {
  const authorization = request.headers.authorization ?? '';
  if (authorization.includes('tenant-b')) {
    return TENANT_B_ID;
  }
  if (authorization.includes('tenant-a')) {
    return TENANT_A_ID;
  }
  if (/^Bearer access-[A-Za-z0-9._-]+$/.test(authorization)) {
    return TENANT_A_ID;
  }
  return null;
}

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

  const isTenantB = body.email.includes('bob') || body.email.includes('tenant-b');
  const tenantId = isTenantB ? TENANT_B_ID : TENANT_A_ID;
  const user = USERS[tenantId];
  const accessToken = isTenantB ? 'access-tenant-b' : 'access-1';
  const refreshTokenVal = isTenantB ? 'refresh-tenant-b' : 'refresh-1';

  sendJson(
    response,
    200,
    {
      accessToken,
      user: { ...user, email: body.email },
    },
    { 'set-cookie': refreshCookie(refreshTokenVal) },
  );
}

async function handleRefresh(request, response) {
  const body = await readJson(request);
  const refreshToken = body === null ? undefined : body.refreshToken;

  if (refreshToken === 'refresh-tenant-b') {
    sendJson(
      response,
      200,
      {
        accessToken: 'access-tenant-b',
        user: { ...USERS[TENANT_B_ID] },
      },
      { 'set-cookie': refreshCookie('refresh-tenant-b') },
    );
    return;
  }

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

  const tenantId = getTenantIdFromRequest(request);
  const from = url.searchParams.get('from') || '2026-10-01';
  const to = url.searchParams.get('to') || '2026-10-30';
  const currency = url.searchParams.get('currency') || 'EUR';

  // Si es Tenant B, devolvemos sus datos aislados
  if (tenantId === TENANT_B_ID) {
    sendJson(response, 200, {
      hasData: true,
      currency: 'EUR',
      availableCurrencies: ['EUR', 'USD'],
      period: { from, to },
      balanceMinor: '9900000',
      incomeMinor: '2100000',
      expenseMinor: '1400000',
      burnRateMinor: '700000',
      runwayMonths: 14.1,
      previousPeriod: {
        incomeMinor: '1900000',
        expenseMinor: '1300000',
      },
      series: [
        { bucketStart: from, incomeMinor: '1000000', expenseMinor: '700000' },
        { bucketStart: to, incomeMinor: '1100000', expenseMinor: '700000' },
      ],
      categories: [
        { category: 'Servicios en la nube', amountMinor: '700000', share: 0.5 },
        { category: 'Nómina', amountMinor: '500000', share: 0.3571 },
        { category: 'Oficina', amountMinor: '200000', share: 0.1429 },
      ],
    });
    return;
  }

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

/** Filas aisladas del libro mayor para Tenant B */
const LEDGER_ROWS_B = [
  {
    id: '00000000-0000-4000-8000-bbbb00000001',
    date: '2026-10-15',
    name: 'Movimiento Exclusivo Tenant B 001',
    merchantName: 'Proveedor Tenant B',
    category: 'Oficina',
    notes: 'Nota confidencial Tenant B',
    amountMinor: '850000',
    isoCurrencyCode: 'EUR',
    accountId: '22222222-2222-4222-8222-222222222222',
    accountName: 'Cuenta Banco Tenant B',
    reconciliationStatus: 'UNMATCHED',
    evidence: null,
    updatedAt: '2026-10-15T09:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-bbbb00000002',
    date: '2026-10-16',
    name: 'Movimiento Exclusivo Tenant B 002',
    merchantName: 'Cloud Services B',
    category: 'Servicios en la nube',
    notes: null,
    amountMinor: '-120000',
    isoCurrencyCode: 'EUR',
    accountId: '22222222-2222-4222-8222-222222222222',
    accountName: 'Cuenta Banco Tenant B',
    reconciliationStatus: 'AUTO_MATCHED',
    evidence: null,
    updatedAt: '2026-10-16T09:00:00.000Z',
  },
];

const LEDGER_B_BY_ID = new Map(LEDGER_ROWS_B.map((row) => [row.id, row]));

function getLedgerRowsForTenant(tenantId) {
  if (tenantId === TENANT_B_ID) {
    return LEDGER_ROWS_B;
  }
  return LEDGER_ROWS;
}

/* ------------------------------------------------------------------------- */
/* Estado en memoria multi-tenant: Banking & Reconciliation                  */
/* ------------------------------------------------------------------------- */

const BANK_CONNECTIONS = {
  [TENANT_A_ID]: [],
  [TENANT_B_ID]: [
    {
      id: 'conn-b-default-001',
      tenantId: TENANT_B_ID,
      provider: 'PLAID',
      institutionName: 'Banco Nacional B',
      status: 'ACTIVE',
      lastSuccessfulSyncAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

const BANK_ACCOUNTS = {
  [TENANT_A_ID]: [],
  [TENANT_B_ID]: [
    {
      id: 'acc-b-default-001',
      tenantId: TENANT_B_ID,
      connectionId: 'conn-b-default-001',
      name: 'Cuenta Operativa Tenant B',
      mask: '4321',
      isoCurrencyCode: 'EUR',
      balanceCurrentMinor: '9900000',
      balanceAvailableMinor: '9900000',
      status: 'ACTIVE',
      lastSyncedAt: new Date().toISOString(),
    },
  ],
};

const RECONCILIATION_SETTINGS = {
  [TENANT_A_ID]: {
    dateWindowDays: 3,
    autoMatchThresholdBps: 9000,
    timezone: 'UTC',
    lookbackDays: 30,
    nightlyEnabled: true,
  },
  [TENANT_B_ID]: {
    dateWindowDays: 5,
    autoMatchThresholdBps: 8500,
    timezone: 'UTC',
    lookbackDays: 60,
    nightlyEnabled: false,
  },
};

const RECONCILIATION_REVIEWS = {
  [TENANT_A_ID]: [],
  [TENANT_B_ID]: [],
};

async function handleBankingConnect(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const body = await readJson(request);
  sendJson(response, 201, {
    provider: body?.provider || 'PLAID',
    linkToken: `link_token_${Date.now()}`,
    expiration: new Date(Date.now() + 3600000).toISOString(),
  });
}

async function handleBankingExchange(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const body = await readJson(request);
  const connId = `conn-${tenantId === TENANT_B_ID ? 'b' : 'a'}-${Date.now()}`;
  const conn = {
    id: connId,
    tenantId,
    provider: body?.provider || 'PLAID',
    institutionName: body?.institution || 'Banco Santander Empresas',
    status: 'ACTIVE',
    lastSuccessfulSyncAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  BANK_CONNECTIONS[tenantId].push(conn);

  const accId = `acc-${tenantId === TENANT_B_ID ? 'b' : 'a'}-${Date.now()}`;
  const acc = {
    id: accId,
    tenantId,
    connectionId: connId,
    name: 'Cuenta Operativa Principal',
    mask: '4890',
    isoCurrencyCode: 'EUR',
    balanceCurrentMinor: '4500000',
    balanceAvailableMinor: '4500000',
    status: 'ACTIVE',
    lastSyncedAt: new Date().toISOString(),
  };
  BANK_ACCOUNTS[tenantId].push(acc);

  sendJson(response, 201, conn);
}

function handleBankingConnections(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  sendJson(response, 200, BANK_CONNECTIONS[tenantId] || []);
}

function handleBankingConnectionAccounts(request, response, connectionId) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const conn = (BANK_CONNECTIONS[tenantId] || []).find((c) => c.id === connectionId);
  if (!conn) {
    sendError(response, 404, 'connection_not_found');
    return;
  }
  const accounts = (BANK_ACCOUNTS[tenantId] || []).filter((a) => a.connectionId === connectionId);
  sendJson(response, 200, accounts);
}

function handleBankingConnectionSync(request, response, connectionId) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const conn = (BANK_CONNECTIONS[tenantId] || []).find((c) => c.id === connectionId);
  if (!conn) {
    sendError(response, 404, 'connection_not_found');
    return;
  }
  conn.lastSuccessfulSyncAt = new Date().toISOString();
  sendJson(response, 200, {
    connectionId,
    added: 3,
    modified: 0,
    removed: 0,
    hasMore: false,
  });
}

function handleReconciliationSettings(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  sendJson(response, 200, RECONCILIATION_SETTINGS[tenantId]);
}

function handleReconciliationReview(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  sendJson(response, 200, RECONCILIATION_REVIEWS[tenantId] || []);
}

async function handleReconciliationRun(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const rows = getLedgerRowsForTenant(tenantId);
  // Seleccionar la fila más reciente para que aparezca en la primera página por defecto
  const targetRow = rows.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const reviewId = `rev-${tenantId === TENANT_B_ID ? 'b' : 'a'}-001`;

  if (targetRow) {
    targetRow.reconciliationStatus = 'NEEDS_REVIEW';
    const reviewItem = {
      id: reviewId,
      tenantId,
      bankTransactionId: targetRow.id,
      documentId: `doc-${tenantId === TENANT_B_ID ? 'b' : 'a'}-001`,
      confidenceScoreBps: 9200,
      status: 'NEEDS_REVIEW',
      suggestedRule: 'EXACT_AMOUNT_DATE',
      discrepancyReasons: ['Diferencia horaria de procesamiento bancario'],
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      bankTransaction: {
        id: targetRow.id,
        name: targetRow.name,
        amountMinor: targetRow.amountMinor,
      },
      document: {
        id: `doc-${tenantId === TENANT_B_ID ? 'b' : 'a'}-001`,
        originalName: 'Factura-Auditoria-SF2.pdf',
        totalMinor: targetRow.amountMinor,
      },
    };
    const existingIdx = (RECONCILIATION_REVIEWS[tenantId] || []).findIndex(
      (r) => r.id === reviewId,
    );
    if (existingIdx >= 0) {
      RECONCILIATION_REVIEWS[tenantId][existingIdx] = reviewItem;
    } else {
      RECONCILIATION_REVIEWS[tenantId].push(reviewItem);
    }
  }

  sendJson(response, 201, {
    runId: `run-${Date.now()}`,
    tenantId,
    status: 'COMPLETED',
    matchedCount: 1,
    reviewCount: 1,
  });
}

function handleReconciliationReviewConfirm(request, response, reviewId) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const reviews = RECONCILIATION_REVIEWS[tenantId] || [];
  const item = reviews.find((r) => r.id === reviewId);
  if (!item) {
    sendError(response, 404, 'review_not_found');
    return;
  }

  item.status = 'MANUAL_MATCHED';
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = USERS[tenantId]?.id || 'user';

  const rows = getLedgerRowsForTenant(tenantId);
  const row = rows.find((r) => r.id === item.bankTransactionId);
  if (row) {
    row.reconciliationStatus = 'MANUAL_MATCHED';
    row.evidence = {
      documentId: item.documentId,
      documentName: item.document?.originalName || 'Factura-Auditoria-SF2.pdf',
      score: 0.98,
      rule: 'EXACT_AMOUNT_DATE',
      matchedAt: new Date().toISOString(),
    };
    row.updatedAt = new Date().toISOString();
  }

  sendJson(response, 200, {
    confirmed: true,
    matchId: reviewId,
    transactionId: item.bankTransactionId,
    status: 'MANUAL_MATCHED',
  });
}

function handleReconciliationReviewReject(request, response, reviewId) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const reviews = RECONCILIATION_REVIEWS[tenantId] || [];
  const item = reviews.find((r) => r.id === reviewId);
  if (!item) {
    sendError(response, 404, 'review_not_found');
    return;
  }

  item.status = 'REJECTED';
  item.reviewedAt = new Date().toISOString();

  const rows = getLedgerRowsForTenant(tenantId);
  const row = rows.find((r) => r.id === item.bankTransactionId);
  if (row) {
    row.reconciliationStatus = 'REJECTED';
    row.evidence = null;
    row.updatedAt = new Date().toISOString();
  }

  sendJson(response, 200, {
    rejected: true,
    matchId: reviewId,
    transactionId: item.bankTransactionId,
    status: 'REJECTED',
  });
}

function handleReconciliationMetrics(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const rows = getLedgerRowsForTenant(tenantId);
  const autoMatched = rows.filter((r) => r.reconciliationStatus === 'AUTO_MATCHED').length;
  const manualMatched = rows.filter((r) => r.reconciliationStatus === 'MANUAL_MATCHED').length;
  const needsReview = rows.filter((r) => r.reconciliationStatus === 'NEEDS_REVIEW').length;
  const rejected = rows.filter((r) => r.reconciliationStatus === 'REJECTED').length;
  const total = autoMatched + manualMatched + needsReview + rejected;

  sendJson(response, 200, {
    totalMatches: total,
    autoMatched,
    manualMatched,
    needsReview,
    rejected,
    autoMatchRate: total > 0 ? Number((autoMatched / total).toFixed(4)) : 0,
    reviewCount: (RECONCILIATION_REVIEWS[tenantId] || []).filter((r) => r.status === 'NEEDS_REVIEW')
      .length,
  });
}

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

function filterLedgerRows(filters, rowsPool = LEDGER_ROWS) {
  return rowsPool.filter((row) => {
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

  const tenantId = getTenantIdFromRequest(request);
  const rowsPool = getLedgerRowsForTenant(tenantId);
  const filters = parseLedgerFilters(url);
  const filtered = filterLedgerRows(filters, rowsPool);
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

  const row = LEDGER_BY_ID.get(id) || LEDGER_B_BY_ID.get(id);

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

  const tenantId = getTenantIdFromRequest(request);
  const rowsPool = getLedgerRowsForTenant(tenantId);
  const filters = parseLedgerFilters(url);
  const rows = sortLedgerRows(
    filterLedgerRows(filters, rowsPool),
    filters.sortBy,
    filters.sortDir,
  ).slice(0, LEDGER_EXPORT_LIMIT);

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

const TRANSACTIONS_STORE = {
  [TENANT_A_ID]: new Map(),
  [TENANT_B_ID]: new Map(),
};

async function handleCreateTransaction(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const body = await readJson(request);
  if (!body || !body.idempotencyKey) {
    sendError(response, 400, 'bad_request');
    return;
  }
  const tenantStore = TRANSACTIONS_STORE[tenantId];
  if (tenantStore.has(body.idempotencyKey)) {
    const existing = tenantStore.get(body.idempotencyKey);
    sendJson(response, 201, existing);
    return;
  }

  const newTx = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    tenantId,
    bankAccountId: body.bankAccountId || 'acc-1',
    amountMinor: body.amountMinor || '25000',
    currency: body.currency || 'EUR',
    type: body.type || 'EXPENSE',
    description: body.description || 'Transacción de prueba',
    category: body.category || 'Operaciones',
    idempotencyKey: body.idempotencyKey,
    createdAt: new Date().toISOString(),
  };

  tenantStore.set(body.idempotencyKey, newTx);
  sendJson(response, 201, newTx);
}

function handleGetTransactions(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const tenantStore = TRANSACTIONS_STORE[tenantId];
  sendJson(response, 200, {
    total: tenantStore.size,
    items: Array.from(tenantStore.values()),
  });
}

/* ------------------------------------------------------------------------- */
/* Agente conversacional (SF3-12 / issue #82)                                */
/*                                                                           */
/* Mock determinista del perímetro del gateway para `POST /agent/chat`.      */
/* Replica el contrato de `AgentChatResponseDto` (contratos SF3-03/SF3-12):  */
/* responder degradado con presupuesto agotado SIN llamar al proveedor,      */
/* citas de herramientas MCP, presupuesto actualizado tras liquidar y       */
/* aislamiento estricto por tenant (memoria/caché por tenant en memoria).    */
/* El proveedor LLM es un stub determinista: cuenta llamadas pero no consume */
/* servicios externos (sin PayPal ni OpenAI en pruebas de carga/E2E).        */
/* ------------------------------------------------------------------------ */

const AGENT_MONTHLY_BUDGET_MICRO_USD = 2_000_000; // 2 USD = 2.000.000 micro-USD

const AGENT_STATE = {
  [TENANT_A_ID]: createAgentState(),
  [TENANT_B_ID]: createAgentState(),
};

function createAgentState() {
  return {
    monthlyBudgetMicroUsd: AGENT_MONTHLY_BUDGET_MICRO_USD,
    remainingMicroUsd: AGENT_MONTHLY_BUDGET_MICRO_USD,
    llmProviderCalls: 0,
    cacheHits: 0,
    degradedEvents: 0,
    /** Caché semántica determinista: match exacto del mensaje por tenant. */
    conversations: [],
    /** Memoria conversacional del tenant (nunca cruza entre tenants). */
    memories: [],
  };
}

function agentState(tenantId) {
  if (!AGENT_STATE[tenantId]) {
    AGENT_STATE[tenantId] = createAgentState();
  }
  return AGENT_STATE[tenantId];
}

/** Cifras de finanzas por tenant, espejo de las del dashboard (EUR, moneda menor). */
const AGENT_FINANCE_FACTS = {
  [TENANT_A_ID]: {
    currency: 'EUR',
    incomeMinor: '1250000',
    expenseMinor: '820000',
    balanceMinor: '4500000',
  },
  [TENANT_B_ID]: {
    currency: 'EUR',
    incomeMinor: '2100000',
    expenseMinor: '1400000',
    balanceMinor: '9900000',
  },
};

const AGENT_CASHFLOW_KEYWORDS = ['flujo', 'cashflow', 'saldo', 'ingresos', 'egresos', 'gastos'];
const AGENT_RECONCILIATION_KEYWORDS = ['conciliar', 'conciliación', 'pendiente', 'sin conciliar'];
const AGENT_PAYMENT_KEYWORDS = ['enlace de cobro', 'payment link', 'cobro paypal'];

/**
 * Moneda menor (centavos) a texto humano; determinista en cualquier runtime
 * (sin `Intl`, cuyo agrupamiento depende del ICU del sistema) e idéntico al
 * formato visible del dashboard (agruto separador de millar con '.').
 */
function agentFormatMinor(minor) {
  const cents = Number(minor);
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents) / 100;
  const integer = Math.trunc(absolute);
  const decimals = Math.round((absolute - integer) * 100)
    .toString()
    .padStart(2, '0');
  const grouped = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${decimals} €`;
}
function agentTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Date más reciente en el rango YYYY-MM-DD; vacío si no aparece ninguno. */
function agentExtractDates(message) {
  return message.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

function agentToolCitation(tool, label, period) {
  return {
    source: 'tool',
    ref: tool,
    tool,
    ...(period !== '' ? { period } : {}),
    label,
  };
}

/** Cita memoria cuyo contenido comparte palabra significativa con el mensaje. */
function agentMemoryCitations(state, message) {
  const keywords = message
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4);

  if (keywords.length === 0) {
    return [];
  }

  return state.memories
    .filter((memory) => keywords.some((keyword) => memory.content.toLowerCase().includes(keyword)))
    .slice(0, 3)
    .map((memory) => ({
      source: 'memory',
      ref: memory.id,
      label: memory.content.length > 160 ? `${memory.content.slice(0, 159)}…` : memory.content,
    }));
}

/** Respuesta degradada según el contrato `AgentChatResponseDto`. */
function agentDegraded(state, code, reason, message) {
  state.degradedEvents += 1;
  return {
    answer: message,
    citations: [],
    degraded: true,
    reason,
    code,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      costMicroUsd: 0,
      budgetRemainingMicroUsd: state.remainingMicroUsd,
      cacheHit: false,
    },
  };
}

/**
 * Llamada al proveedor LLM (stub determinista): compone la respuesta a partir
 * de los hechos de herramientas e incrementa el contador de invocaciones.
 */
function agentLlmStubComplete(state, question, facts, citations) {
  state.llmProviderCalls += 1;
  const promptTokens = agentTokens(question) + 48;
  const completionTokens = 96;
  const costMicroUsd = promptTokens * 2 + completionTokens * 8;
  const remainingMicroUsd = Math.max(0, state.remainingMicroUsd - costMicroUsd);
  state.remainingMicroUsd = remainingMicroUsd;

  const parts = [];
  if (facts.tool === 'get_cashflow_summary') {
    parts.push(
      `Entre ${facts.from} y ${facts.to} tus ingresos son ${agentFormatMinor(facts.incomeMinor)} y tus gastos ${agentFormatMinor(facts.expenseMinor)}, con un saldo consolidado de ${agentFormatMinor(facts.balanceMinor)}.`,
    );
  } else if (facts.tool === 'list_unreconciled_transactions') {
    parts.push(
      `Tienes ${facts.count} movimientos pendientes de conciliar${facts.names.length > 0 ? `; los más recientes son: ${facts.names.join(', ')}` : ''}.`,
    );
  } else if (facts.tool === 'create_payment_link') {
    parts.push(
      `He creado el enlace de cobro por ${agentFormatMinor(facts.amountMinor)} (${facts.currency}): ${facts.checkoutUrl} (estado ${facts.status}).`,
    );
  }

  if (citations.some((citation) => citation.source === 'memory')) {
    parts.push('He recuperado contexto previo de tu memoria conversacional.');
  }

  return {
    answer: parts.join(' ') || 'No tengo datos suficientes para responder con fundamento.',
    citations,
    degraded: false,
    usage: {
      promptTokens,
      completionTokens,
      costMicroUsd,
      budgetRemainingMicroUsd: remainingMicroUsd,
      cacheHit: false,
    },
  };
}

async function handleAgentChat(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const state = agentState(tenantId);
  const body = await readJson(request);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const normalized = message.toLowerCase();

  if (message.length === 0) {
    sendError(response, 400, 'message_required');
    return;
  }

  // RBAC del gateway: sólo TENANT_ADMIN/ACCOUNTANT/SUPER_ADMIN conversan.
  const effectiveRole = request.headers['x-e2e-role'] ?? 'TENANT_ADMIN';
  if (['AUDITOR', 'VIEWER', 'OWNER'].includes(effectiveRole)) {
    sendError(response, 403, 'insufficient_permissions');
    return;
  }

  // 1. Caché semántica determinista (match exacto dentro del tenant).
  const cached = state.conversations.find((entry) => entry.message === message);
  if (cached) {
    state.cacheHits += 1;
    sendJson(response, 200, {
      ...cached.response,
      usage: {
        ...cached.response.usage,
        cacheHit: true,
        costMicroUsd: 0,
        budgetRemainingMicroUsd: state.remainingMicroUsd,
      },
    });
    return;
  }

  // 1.b Control determinista de drenaje de presupuesto por mensaje (QA #82):
  // la reserva no es posible y el tenant queda agotado para el periodo.
  if (/\bagotar presupuesto\b|\bdrain budget\b/.test(normalized)) {
    state.remainingMicroUsd = 0;
    sendJson(
      response,
      200,
      agentDegraded(
        state,
        'BUDGET_EXHAUSTED',
        'BUDGET_EXHAUSTED',
        'El presupuesto mensual de tokens se agotó. El asistente responde en modo degradado hasta el siguiente periodo.',
      ),
    );
    return;
  }

  // 2. Control de escenarios E2E deterministas.
  const scenario = request.headers['x-e2e-scenario'];
  if (scenario === 'budget-exhausted') {
    sendJson(
      response,
      200,
      agentDegraded(
        state,
        'BUDGET_EXHAUSTED',
        'BUDGET_EXHAUSTED',
        'El presupuesto mensual de tokens se agotó. El asistente responde en modo degradado hasta el siguiente periodo.',
      ),
    );
    return;
  }

  // 3. Presupuesto: sin reserva posible, responde degradado y sin proveedor.
  if (state.remainingMicroUsd <= 0) {
    sendJson(
      response,
      200,
      agentDegraded(
        state,
        'BUDGET_EXHAUSTED',
        'BUDGET_EXHAUSTED',
        'El presupuesto mensual de tokens se agotó. El asistente responde en modo degradado hasta el siguiente periodo.',
      ),
    );
    return;
  }

  // 4. Router determinista (espejo del router de palabras clave del chat.service).
  const dates = agentExtractDates(message);
  const allToolsFailed =
    scenario === 'all-tools-failed' || /\bfallo de herramientas\b/.test(normalized);
  const citedTools = [];
  let facts = null;

  const wantsPaymentLink =
    !allToolsFailed && AGENT_PAYMENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const wantsCashflow =
    !allToolsFailed && AGENT_CASHFLOW_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const wantsReconciliation =
    !allToolsFailed &&
    !wantsCashflow &&
    AGENT_RECONCILIATION_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (wantsCashflow) {
    const from = dates[0] ?? '2026-10-01';
    const to = dates[1] ?? '2026-10-31';
    const finance = AGENT_FINANCE_FACTS[tenantId];
    facts = { tool: 'get_cashflow_summary', from, to, ...finance };
    citedTools.push(
      agentToolCitation('get_cashflow_summary', 'Resumen de flujo de caja', `${from}/${to}`),
    );
  } else if (wantsReconciliation) {
    const rows = getLedgerRowsForTenant(tenantId);
    const pending = rows.filter((row) => row.reconciliationStatus === 'UNMATCHED');
    facts = {
      tool: 'list_unreconciled_transactions',
      count: pending.length,
      names: pending.slice(0, 3).map((row) => row.name),
    };
    citedTools.push(
      agentToolCitation(
        'list_unreconciled_transactions',
        'Transacciones pendientes de conciliación',
        '',
      ),
    );
  } else if (wantsPaymentLink) {
    facts = {
      tool: 'create_payment_link',
      amountMinor: '250000',
      currency: 'EUR',
      status: 'CREATED',
      // Sin PayPal sandbox: el stub genérico evita infra de dinero en QA (#82).
      checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=MOCK-4F11AD22',
    };
    citedTools.push(agentToolCitation('create_payment_link', 'Enlace de cobro PayPal', ''));
  }

  // 5. Todas las herramientas fallaron: degradado determinista, proveedor no
  //    invocado y reserva de presupuesto liberada (contrato chat.service).
  if (citedTools.length === 0) {
    sendJson(
      response,
      200,
      agentDegraded(
        state,
        'ALL_TOOLS_FAILED',
        'PROVIDER_ERROR',
        'No pude completar la consulta con las herramientas disponibles. Inténtalo de nuevo en unos minutos.',
      ),
    );
    return;
  }

  // 6. Memoria conversacional del tenant + stub LLM ("con stub").
  const citations = [...citedTools, ...agentMemoryCitations(state, message)];
  const answer = agentLlmStubComplete(state, message, facts, citations);

  state.conversations.push({ message, response: answer });
  state.memories.push({
    id: `mem-${tenantId.slice(0, 8)}-${state.memories.length + 1}`,
    content: `Pregunta: ${message}\nRespuesta: ${answer.answer}`,
  });
  if (state.memories.length > 20) {
    state.memories.shift();
  }

  sendJson(response, 200, answer);
}

function handleAgentBudget(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const state = agentState(tenantId);
  sendJson(response, 200, {
    periodKey: new Date().toISOString().slice(0, 7),
    currency: 'MICRO_USD',
    monthlyBudgetMicroUsd: state.monthlyBudgetMicroUsd,
    remainingMicroUsd: state.remainingMicroUsd,
    usedMicroUsd: state.monthlyBudgetMicroUsd - state.remainingMicroUsd,
  });
}

function handleAgentDevStats(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const state = agentState(tenantId);
  sendJson(response, 200, {
    tenantId,
    llmProviderCalls: state.llmProviderCalls,
    cacheHits: state.cacheHits,
    degradedEvents: state.degradedEvents,
    remainingMicroUsd: state.remainingMicroUsd,
    memories: state.memories.length,
    conversations: state.conversations.length,
  });
}

function handleAgentDevReset(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  AGENT_STATE[tenantId] = createAgentState();
  sendJson(response, 200, { reset: tenantId });
}

const server = createServer((request, response) => {
  response.on('finish', () => {
    request.resume();
  });
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (
    method === 'GET' &&
    (path === '/health' || path === '/healthz' || path === '/api/v1/health')
  ) {
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

  // Banking endpoints
  if (
    method === 'POST' &&
    (path === '/api/v1/banking/connect' || path === '/api/v1/banking/link-token')
  ) {
    void handleBankingConnect(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/banking/exchange') {
    void handleBankingExchange(request, response);
    return;
  }

  if (method === 'GET' && path === '/api/v1/banking/connections') {
    handleBankingConnections(request, response);
    return;
  }

  const accountsMatch = /^\/api\/v1\/banking\/connections\/([^/]+)\/accounts$/.exec(path);
  if (method === 'GET' && accountsMatch !== null) {
    handleBankingConnectionAccounts(request, response, decodeURIComponent(accountsMatch[1]));
    return;
  }

  const syncMatch = /^\/api\/v1\/banking\/connections\/([^/]+)\/sync$/.exec(path);
  if (method === 'POST' && syncMatch !== null) {
    handleBankingConnectionSync(request, response, decodeURIComponent(syncMatch[1]));
    return;
  }

  // Reconciliation endpoints
  if (method === 'GET' && path === '/api/v1/finance/reconciliation/settings') {
    handleReconciliationSettings(request, response);
    return;
  }

  if (method === 'GET' && path === '/api/v1/finance/reconciliation/review') {
    handleReconciliationReview(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/finance/reconciliation/run') {
    void handleReconciliationRun(request, response);
    return;
  }

  const reviewConfirmMatch = /^\/api\/v1\/finance\/reconciliation\/review\/([^/]+)\/confirm$/.exec(
    path,
  );
  if (method === 'POST' && reviewConfirmMatch !== null) {
    handleReconciliationReviewConfirm(request, response, decodeURIComponent(reviewConfirmMatch[1]));
    return;
  }

  const reviewRejectMatch = /^\/api\/v1\/finance\/reconciliation\/review\/([^/]+)\/reject$/.exec(
    path,
  );
  if (method === 'POST' && reviewRejectMatch !== null) {
    handleReconciliationReviewReject(request, response, decodeURIComponent(reviewRejectMatch[1]));
    return;
  }

  if (method === 'GET' && path === '/api/v1/finance/reconciliation/metrics') {
    handleReconciliationMetrics(request, response);
    return;
  }

  async function handleFinanceAccountsPost(request, response) {
    const tenantId = getTenantIdFromRequest(request) || TENANT_A_ID;
    const body = await readJson(request);
    const accId = `acc-${Date.now()}`;
    const newAcc = {
      id: accId,
      tenantId,
      institutionName: body?.institutionName || 'Load Test Bank',
      accountType: body?.accountType || 'CHECKING',
      accountNumberMasked: body?.accountNumberMasked || '******0054',
      currency: body?.currency || 'COP',
      status: 'ACTIVE',
      balanceMinor: '0',
    };
    if (!BANK_ACCOUNTS[tenantId]) BANK_ACCOUNTS[tenantId] = [];
    BANK_ACCOUNTS[tenantId].push(newAcc);
    sendJson(response, 201, { success: true, data: newAcc });
  }

  // Accounts endpoints (finance)
  if (path === '/api/v1/finance/accounts') {
    if (method === 'GET') {
      const tenantId = getTenantIdFromRequest(request) || TENANT_A_ID;
      const accounts = BANK_ACCOUNTS[tenantId] || [];
      sendJson(response, 200, { success: true, data: accounts });
      return;
    }
    if (method === 'POST') {
      void handleFinanceAccountsPost(request, response);
      return;
    }
  }

  // Transactions endpoints (para ingest y pruebas de carga)
  if (path === '/api/v1/finance/transactions') {
    if (method === 'POST') {
      void handleCreateTransaction(request, response);
      return;
    }
    if (method === 'GET') {
      handleGetTransactions(request, response);
      return;
    }
  }

  // Agente conversacional (SF3-12 / #82)
  if (method === 'POST' && path === '/api/v1/agent/chat') {
    void handleAgentChat(request, response);
    return;
  }
  if (method === 'GET' && path === '/api/v1/agent/budget') {
    handleAgentBudget(request, response);
    return;
  }
  if (method === 'GET' && path === '/api/v1/agent/dev/stats') {
    handleAgentDevStats(request, response);
    return;
  }
  if (method === 'POST' && path === '/api/v1/agent/dev/reset') {
    handleAgentDevReset(request, response);
    return;
  }

  sendError(response, 404, 'not_found');
});

server.listen(PORT, HOST);
