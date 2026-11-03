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

  sendError(response, 404, 'not_found');
});

server.listen(PORT, HOST);
