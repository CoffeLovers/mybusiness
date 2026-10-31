import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` lanza al importarse fuera del grafo RSC; en pruebas se neutraliza.
vi.mock('server-only', () => ({}));

const cookieStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: (): Promise<{ get: (name: string) => { name: string; value: string } | undefined }> =>
    Promise.resolve({
      get: (name: string): { name: string; value: string } | undefined => {
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

import { CSRF_COOKIE, SESSION_COOKIE } from '../lib/session/cookies';
import { openSession, sealSession } from '../lib/session/crypto';
import {
  clearSessionCookies,
  readSession,
  requireSession,
  sessionIdFrom,
  sessionResponseBody,
  setSessionCookie,
} from '../lib/session/server';
import type { SessionRecord } from '../lib/session/types';
import { GatewayError, gatewayFetch } from '../lib/server/gateway-client';

const SECRET = 'a'.repeat(32);
const GATEWAY_URL = 'http://gateway.internal:8080';
const NOW = Date.now();

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
    issuedAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('WEB_SESSION_SECRET', SECRET);
  vi.stubEnv('WEB_GATEWAY_URL', GATEWAY_URL);
  cookieStore.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gatewayFetch', () => {
  it('devuelve el JSON en respuestas correctas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(gatewayFetch<{ ok: boolean }>('/users', { method: 'GET' })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${GATEWAY_URL}/users`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('envía cabeceras de body, autorización y cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await gatewayFetch('/login', {
      method: 'POST',
      body: { email: 'ana@example.com' },
      accessToken: 'token-1',
      cookie: 'mb_session=abc',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer token-1',
      cookie: 'mb_session=abc',
    });
    expect(init.body).toBe(JSON.stringify({ email: 'ana@example.com' }));
  });

  it('devuelve undefined en 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(gatewayFetch('/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('lanza GatewayError con el mensaje del cuerpo', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'invalid_credentials' }), { status: 401 }),
        ),
    );

    await expect(gatewayFetch('/login')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
      code: 'invalid_credentials',
    });
  });

  it('usa `error` y cae en gateway_error ante cuerpos inválidos', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
        ),
    );
    await expect(gatewayFetch('/fail')).rejects.toBeInstanceOf(GatewayError);
    await expect(gatewayFetch('/fail')).rejects.toMatchObject({ code: 'boom' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no-json', { status: 502 })));
    await expect(gatewayFetch('/fail')).rejects.toMatchObject({ code: 'gateway_error' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 503 })),
    );
    await expect(gatewayFetch('/fail')).rejects.toMatchObject({ code: 'gateway_error' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 504 })));
    await expect(gatewayFetch('/fail')).rejects.toMatchObject({ code: 'gateway_error' });
  });
});

describe('readSession', () => {
  it('devuelve null sin cookie', async () => {
    await expect(readSession()).resolves.toBeNull();
  });

  it('devuelve null con una cookie inválida', async () => {
    cookieStore.set(SESSION_COOKIE, 'v1.invalid');
    await expect(readSession()).resolves.toBeNull();
  });

  it('devuelve la sesión válida', async () => {
    const session = makeSession();
    cookieStore.set(SESSION_COOKIE, sealSession(session, SECRET));

    await expect(readSession()).resolves.toEqual(session);
    await expect(requireSession()).resolves.toEqual(session);
  });

  it('devuelve null si la sesión caducó', async () => {
    const session = makeSession({ issuedAt: NOW - 13 * 60 * 60 * 1000 });
    cookieStore.set(SESSION_COOKIE, sealSession(session, SECRET));

    await expect(readSession()).resolves.toBeNull();
  });
});

describe('cookies de sesión', () => {
  it('escribe la cookie httpOnly y el CSRF legible', () => {
    const response = NextResponse.json({ ok: true });
    const session = makeSession();

    setSessionCookie(response, session);

    const sessionCookie = response.cookies.get(SESSION_COOKIE);
    const csrfCookie = response.cookies.get(CSRF_COOKIE);

    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('lax');
    expect(sessionCookie?.path).toBe('/');
    expect(sessionCookie?.maxAge).toBe(12 * 60 * 60);
    expect(openSession(sessionCookie?.value ?? '', SECRET)).toEqual(session);

    expect(csrfCookie?.httpOnly).toBe(false);
    expect(csrfCookie?.value?.length).toBeGreaterThan(0);
  });

  it('elimina ambas cookies', () => {
    const response = NextResponse.json({ ok: true });

    clearSessionCookies(response);

    expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(CSRF_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(SESSION_COOKIE)?.path).toBe('/');
  });
});

describe('sessionResponseBody', () => {
  it('expone sólo el usuario y la caducidad absoluta', () => {
    const session = makeSession();

    expect(sessionResponseBody(session)).toEqual({
      user: session.user,
      expiresAt: new Date(session.issuedAt + 12 * 60 * 60 * 1000).toISOString(),
    });
  });
});

describe('sessionIdFrom', () => {
  function makeRequest(cookieValue?: string): NextRequest {
    const request = new NextRequest(new URL('http://localhost:3001/api/session/logout'), {
      method: 'POST',
    });

    if (cookieValue !== undefined) {
      request.cookies.set(SESSION_COOKIE, cookieValue);
    }

    return request;
  }

  it('extrae el id aunque la sesión esté caducada', () => {
    const session = makeSession({ issuedAt: NOW - 13 * 60 * 60 * 1000 });
    expect(sessionIdFrom(makeRequest(sealSession(session, SECRET)))).toBe(session.sessionId);
  });

  it('devuelve undefined sin cookie o con token inválido', () => {
    expect(sessionIdFrom(makeRequest())).toBeUndefined();
    expect(sessionIdFrom(makeRequest('v1.invalid'))).toBeUndefined();
  });
});
