/**
 * Gateway falso para los E2E del portal web.
 *
 * Implementa sólo los endpoints que consume el BFF durante las pruebas de
 * sesión, con estado en memoria para verificar la rotación de tokens.
 * Sin dependencias: `node:http` y nada más.
 */

import { randomUUID } from 'node:crypto';
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

const BANK_DEFAULT_CONNECTION_A_ID = '11111111-1111-4111-8111-111111111111';

const BANK_CONNECTIONS = {
  [TENANT_A_ID]: [
    {
      id: BANK_DEFAULT_CONNECTION_A_ID,
      tenantId: TENANT_A_ID,
      provider: 'plaid',
      institutionName: 'Banco Andino Central',
      status: 'active',
      lastSuccessfulSyncAt: '2026-10-30T09:00:00.000Z',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-10-30T09:00:00.000Z',
    },
  ],
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
  [TENANT_A_ID]: [
    {
      id: '22222222-2222-4222-8222-222222222221',
      tenantId: TENANT_A_ID,
      connectionId: BANK_DEFAULT_CONNECTION_A_ID,
      providerAccountId: 'provider-acc-a-001',
      name: 'Cuenta Corriente Principal',
      officialName: 'Cuenta Corriente Principal',
      type: 'depository',
      subtype: 'checking',
      mask: '1234',
      isoCurrencyCode: 'EUR',
      balanceCurrentMinor: '125050',
      balanceAvailableMinor: '120000',
      status: 'active',
      lastSyncedAt: '2026-10-30T09:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: TENANT_A_ID,
      connectionId: BANK_DEFAULT_CONNECTION_A_ID,
      providerAccountId: 'provider-acc-a-002',
      name: 'Cuenta de Ahorro Nómina',
      officialName: 'Cuenta de Ahorro Nómina',
      type: 'depository',
      subtype: 'savings',
      mask: '9876',
      isoCurrencyCode: 'EUR',
      balanceCurrentMinor: '830075',
      balanceAvailableMinor: '830075',
      status: 'active',
      lastSyncedAt: '2026-10-29T18:30:00.000Z',
    },
  ],
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

/** Token de Plaid Link determinista para que los E2E puedan afirmarlo. */
function handleBankingLinkToken(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  sendJson(response, 200, {
    linkToken: 'link-sandbox-test',
    expiration: '2030-01-01T00:00:00Z',
  });
}

async function handleBankingExchange(request, response) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const body = await readJson(request);
  const connId = randomUUID();
  const conn = {
    id: connId,
    tenantId,
    provider: body?.provider || 'plaid',
    institutionName: body?.institution || 'Banco Santander Empresas',
    status: 'ACTIVE',
    lastSuccessfulSyncAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  BANK_CONNECTIONS[tenantId].push(conn);

  const accId = randomUUID();
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

function handleBankingConnectionDelete(request, response, connectionId) {
  const tenantId = getTenantIdFromRequest(request);
  if (!tenantId) {
    sendError(response, 401, 'unauthorized');
    return;
  }
  const connections = BANK_CONNECTIONS[tenantId] || [];
  const index = connections.findIndex((c) => c.id === connectionId);
  if (index < 0) {
    sendError(response, 404, 'connection_not_found');
    return;
  }
  connections.splice(index, 1);
  BANK_ACCOUNTS[tenantId] = (BANK_ACCOUNTS[tenantId] || []).filter(
    (account) => account.connectionId !== connectionId,
  );
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
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
/* Agente conversacional (SF3-05)                                            */
/* ------------------------------------------------------------------------- */

const AGENT_BUDGET = {
  limitMicroUsd: 50_000_000,
  spentMicroUsd: 12_000_000,
  reservedMicroUsd: 0,
  availableMicroUsd: 38_000_000,
  warnRatio: 0.8,
  hardLimit: true,
  isExhausted: false,
  isWarning: false,
  periodKey: '2026-11',
};

/** Restante decreciente entre respuestas para verificar la barra en la UI. */
let agentBudgetRemainingMicroUsd = 38_000_000;

function handleAgentBudget(request, response) {
  const authorization = request.headers.authorization ?? '';

  if (!/^Bearer access-[A-Za-z0-9._-]+$/.test(authorization)) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  sendJson(response, 200, AGENT_BUDGET);
}

async function handleAgentChat(request, response) {
  const authorization = request.headers.authorization ?? '';

  if (!/^Bearer access-[A-Za-z0-9._-]+$/.test(authorization)) {
    sendError(response, 401, 'unauthorized');
    return;
  }

  const body = await readJson(request);
  const message = body !== null && typeof body.message === 'string' ? body.message : '';

  if (message.includes('fail')) {
    sendError(response, 502, 'provider_error');
    return;
  }

  if (message.includes('degraded')) {
    sendJson(response, 200, {
      answer: 'No puedo consultar el modelo ahora. Estos son los datos verificados disponibles.',
      citations: [],
      degraded: true,
      reason: message.includes('budget') ? 'BUDGET_EXHAUSTED' : 'PROVIDER_UNAVAILABLE',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        costMicroUsd: 0,
        budgetRemainingMicroUsd: agentBudgetRemainingMicroUsd,
        cacheHit: false,
      },
    });
    return;
  }

  agentBudgetRemainingMicroUsd = Math.max(0, agentBudgetRemainingMicroUsd - 500_000);

  sendJson(response, 200, {
    answer: 'Tu saldo actual es 45.000,00 € y el flujo de caja del mes es positivo.',
    citations: [
      {
        source: 'tool',
        ref: 'cashflow-2026-11',
        tool: 'get_cashflow_summary',
        period: '2026-11',
        label: 'Resumen de flujo de caja',
      },
      {
        source: 'memory',
        ref: 'memory-currency-preference',
        label: 'Preferencia de moneda EUR',
      },
    ],
    degraded: false,
    usage: {
      promptTokens: 120,
      completionTokens: 48,
      costMicroUsd: 320,
      budgetRemainingMicroUsd: agentBudgetRemainingMicroUsd,
      cacheHit: false,
    },
  });
}

async function handleAgentChatStream(request, response) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
  }
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    sendJson(response, 400, { error: 'invalid_json' });
    return;
  }

  const message = typeof body.message === 'string' ? body.message : '';

  if (message.includes('fail')) {
    sendJson(response, 500, { error: 'PROVIDER_ERROR' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (message.includes('cancel')) {
    response.write(
      `id: 1\nevent: token\ndata: ${JSON.stringify({ token: 'Iniciando proceso largo...' })}\n\n`,
    );
    const interval = setInterval(() => {
      response.write(
        `id: 2\nevent: token\ndata: ${JSON.stringify({ token: ' procesando...' })}\n\n`,
      );
    }, 200);
    request.on('close', () => {
      clearInterval(interval);
      response.end();
    });
    return;
  }

  const lastEventId = parseInt(request.headers['last-event-id'] || '0', 10) || 0;
  const events = [];
  let id = 1;

  if (message.includes('degraded')) {
    events.push({
      id: String(id++),
      type: 'done',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        costMicroUsd: 0,
        budgetRemainingMicroUsd: agentBudgetRemainingMicroUsd,
        cacheHit: false,
      },
      degraded: true,
      reason: message.includes('budget') ? 'BUDGET_EXHAUSTED' : 'PROVIDER_UNAVAILABLE',
    });
  } else {
    events.push({
      id: String(id++),
      type: 'tool',
      tool: 'get_cashflow_summary',
      status: 'start',
      period: '2026-11',
    });
    events.push({
      id: String(id++),
      type: 'citation',
      citation: {
        source: 'tool',
        ref: 'cashflow-2026-11',
        tool: 'get_cashflow_summary',
        period: '2026-11',
        label: 'Resumen de flujo de caja',
      },
    });
    events.push({
      id: String(id++),
      type: 'citation',
      citation: {
        source: 'memory',
        ref: 'memory-currency-preference',
        label: 'Preferencia de moneda EUR',
      },
    });
    events.push({
      id: String(id++),
      type: 'tool',
      tool: 'get_cashflow_summary',
      status: 'complete',
      period: '2026-11',
    });
    events.push({
      id: String(id++),
      type: 'token',
      delta: 'Tu saldo actual es 45.000,00 €',
    });
    events.push({
      id: String(id++),
      type: 'token',
      delta: ' y el flujo de caja del mes es positivo.',
    });

    agentBudgetRemainingMicroUsd = Math.max(0, agentBudgetRemainingMicroUsd - 500_000);

    events.push({
      id: String(id++),
      type: 'done',
      usage: {
        promptTokens: 120,
        completionTokens: 48,
        costMicroUsd: 320,
        budgetRemainingMicroUsd: agentBudgetRemainingMicroUsd,
        cacheHit: false,
      },
      degraded: false,
    });
  }

  for (const ev of events) {
    if (parseInt(ev.id, 10) > lastEventId) {
      response.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  }

  response.end();
}

const server = createServer((request, response) => {
  response.on('finish', () => {
    request.resume();
  });
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (method === 'GET' && path === '/api/v1/agent/budget') {
    handleAgentBudget(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/agent/chat') {
    void handleAgentChat(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/agent/chat/stream') {
    void handleAgentChatStream(request, response);
    return;
  }

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
  if (method === 'POST' && path === '/api/v1/banking/connect') {
    void handleBankingConnect(request, response);
    return;
  }

  if (method === 'POST' && path === '/api/v1/banking/link-token') {
    handleBankingLinkToken(request, response);
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

  const connectionMatch = /^\/api\/v1\/banking\/connections\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && connectionMatch !== null) {
    handleBankingConnectionDelete(request, response, decodeURIComponent(connectionMatch[1]));
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

  sendError(response, 404, 'not_found');
});

server.listen(PORT, HOST);
