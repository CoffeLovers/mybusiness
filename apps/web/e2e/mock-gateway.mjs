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

const server = createServer((request, response) => {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', `http://${HOST}:${PORT}`).pathname;

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

  sendError(response, 404, 'not_found');
});

server.listen(PORT, HOST);
