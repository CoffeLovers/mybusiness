import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateCsrfToken } from '../lib/session/crypto';
import type { SessionRecord } from '../lib/session/types';
import { gatewayFetchWithHeaders } from '../lib/server/gateway-client';
import { extractCookie, guardMutation, jsonError, noStore } from '../lib/server/route-helpers';

const SECRET = 'a'.repeat(32);
const GATEWAY_URL = 'http://gateway.internal:8080';
const API_URL = 'http://localhost:3001/api/session/refresh';
const ALLOWED = ['http://localhost:3001'];

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    version: 1,
    sessionId: 'session-1',
    deviceId: 'device-1',
    user: {
      id: 'user-1',
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      role: 'owner',
      tenantId: 'tenant-1',
    },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

/** Petición mutante con origen permitido y, opcionalmente, CSRF válido. */
function makeRequest(hasCsrf = false): NextRequest {
  const session = makeSession();
  const token = generateCsrfToken(SECRET, session.sessionId);
  const headers: Record<string, string> = { origin: ALLOWED[0] ?? '' };

  if (hasCsrf) {
    headers['x-csrf-token'] = token;
  }

  const request = new NextRequest(new URL(API_URL), { method: 'POST', headers });

  if (hasCsrf) {
    request.cookies.set('mb_csrf', token);
  }

  return request;
}

beforeEach(() => {
  vi.stubEnv('WEB_SESSION_SECRET', SECRET);
  vi.stubEnv('WEB_GATEWAY_URL', GATEWAY_URL);
  vi.stubEnv('WEB_ALLOWED_ORIGINS', ALLOWED.join(','));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('jsonError', () => {
  it('devuelve el código estable, el status y no-cache', async () => {
    const response = jsonError(403, 'csrf_invalid');

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'csrf_invalid', status: 403 });
  });
});

describe('noStore', () => {
  it('usa 200 por defecto y marca la respuesta como no cacheable', async () => {
    const response = noStore({ ok: true });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('respeta el status explícito', () => {
    expect(noStore({ ok: true }, 201).status).toBe(201);
  });
});

describe('guardMutation', () => {
  it('rechaza orígenes no permitidos', async () => {
    const request = new NextRequest(new URL(API_URL), {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    });
    const response = guardMutation(request);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: 'origin_not_allowed', status: 403 });
  });

  it('permite el login (sin sesión ni CSRF) con origen válido', () => {
    expect(guardMutation(makeRequest())).toBeNull();
  });

  it('exige 401 cuando el llamador afirma que no hay sesión', async () => {
    const request = makeRequest();
    const response = guardMutation(request, null);

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'session_required', status: 401 });
  });

  it('acepta el tercer argumento con sesión explícita nula', async () => {
    const response = guardMutation(makeRequest(), undefined, { session: null });

    expect(response?.status).toBe(401);
  });

  it('exige CSRF cuando hay sesión', async () => {
    const response = guardMutation(makeRequest(), makeSession());

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: 'csrf_invalid', status: 403 });
  });

  it('acepta una mutación con CSRF válido', () => {
    expect(guardMutation(makeRequest(true), makeSession())).toBeNull();
  });

  it('respeta la sesión declarada en las opciones', () => {
    expect(guardMutation(makeRequest(true), undefined, { session: makeSession() })).toBeNull();
  });
});

describe('extractCookie', () => {
  it('devuelve el valor de la primera coincidencia', () => {
    expect(
      extractCookie(
        [
          'other=1; Path=/',
          'mybusiness_refresh_token=abc123; Path=/api/v1/auth; HttpOnly',
          'mybusiness_refresh_token=zzz; Path=/',
        ],
        'mybusiness_refresh_token',
      ),
    ).toBe('abc123');
  });

  it('decodifica valores con escape de URL', () => {
    expect(extractCookie(['token=a%20b%3Dc; Path=/'], 'token')).toBe('a b=c');
  });

  it('devuelve undefined si no existe, está vacía o mal codificada', () => {
    expect(extractCookie([], 'token')).toBeUndefined();
    expect(extractCookie(['token=; Path=/'], 'token')).toBeUndefined();
    expect(extractCookie(['token=%E0%A4%A; Path=/'], 'token')).toBeUndefined();
    expect(extractCookie(['other=1'], 'token')).toBeUndefined();
  });
});

describe('gatewayFetchWithHeaders', () => {
  it('devuelve el cuerpo y las cabeceras set-cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: 'a', user: { id: 'u' } }), {
          status: 200,
          headers: { 'set-cookie': 'mybusiness_refresh_token=r1; Path=/api/v1/auth' },
        }),
      ),
    );

    const result = await gatewayFetchWithHeaders<{ accessToken: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'ana@example.com' },
    });

    expect(result.data).toEqual({ accessToken: 'a', user: { id: 'u' } });
    expect(result.setCookie).toEqual(['mybusiness_refresh_token=r1; Path=/api/v1/auth']);
  });

  it('devuelve un array vacío y data undefined en 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(gatewayFetchWithHeaders('/api/v1/auth/logout')).resolves.toEqual({
      data: undefined,
      setCookie: [],
    });
  });

  it('propaga GatewayError sin propagar el cuerpo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'boom' }), { status: 500 })),
    );

    await expect(gatewayFetchWithHeaders('/api/v1/auth/login')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 500,
      code: 'boom',
    });
  });
});
