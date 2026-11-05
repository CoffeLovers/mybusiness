import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GatewayError,
  gatewayFetchText,
  gatewayFetchWithHeaders,
} from '../lib/server/gateway-client';

const SECRET = 'a'.repeat(32);
const GATEWAY_URL = 'http://gateway.internal:8080';

/** Mock de `fetch` que resuelve con una única respuesta. */
function stubFetch(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

/** Respuesta JSON del gateway con el envelope de `TransformInterceptor`. */
function envelopeResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('WEB_SESSION_SECRET', SECRET);
  vi.stubEnv('WEB_GATEWAY_URL', GATEWAY_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gatewayFetchWithHeaders (#106)', () => {
  it('desenvuelve el envelope y devuelve sólo el payload', async () => {
    stubFetch(
      envelopeResponse({
        success: true,
        data: { accessToken: 'a', user: { id: 'u', email: 'ana@example.com' } },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    );

    const result = await gatewayFetchWithHeaders<{ accessToken: string }>('/api/v1/auth/login');

    expect(result.data).toEqual({ accessToken: 'a', user: { id: 'u', email: 'ana@example.com' } });
  });

  it('conserva las respuestas directas sin envelope (mocks y endpoints planos)', async () => {
    stubFetch(envelopeResponse({ accessToken: 'a' }));

    const result = await gatewayFetchWithHeaders<{ accessToken: string }>('/api/v1/auth/login');

    expect(result.data).toEqual({ accessToken: 'a' });
  });

  it('devuelve el objeto tal cual si el envelope no trae data', async () => {
    stubFetch(envelopeResponse({ success: true }));

    const result = await gatewayFetchWithHeaders<{ success: boolean }>('/api/v1/auth/login');

    expect(result.data).toEqual({ success: true });
  });

  it('lanza GatewayError 502 con código estable si success es false', async () => {
    stubFetch(envelopeResponse({ success: false, data: null, timestamp: '2026-01-01T00:00:00Z' }));

    const error = await gatewayFetchWithHeaders('/api/v1/auth/login').catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({
      name: 'GatewayError',
      status: 502,
      code: 'gateway_unsuccessful_response',
    });
  });

  it('conserva el GatewayError original en respuestas HTTP no satisfactorias', async () => {
    stubFetch(new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 }));

    await expect(gatewayFetchWithHeaders('/api/v1/auth/login')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
      code: 'unauthorized',
    });
  });
});

describe('gatewayFetchText (#106)', () => {
  it('extrae el data string de un envelope JSON conservando las cabeceras', async () => {
    stubFetch(
      new Response(JSON.stringify({ success: true, data: 'a,b\n1,2' }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="ledger.csv"',
        },
      }),
    );

    const result = await gatewayFetchText('/api/v1/finance/ledger/export');

    expect(result.body).toBe('a,b\n1,2');
    expect(result.contentType).toBe('application/json; charset=utf-8');
    expect(result.contentDisposition).toBe('attachment; filename="ledger.csv"');
  });

  it('deja intacto un CSV plano', async () => {
    stubFetch(
      new Response('a,b\n1,2', {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      }),
    );

    const result = await gatewayFetchText('/api/v1/finance/ledger/export');

    expect(result.body).toBe('a,b\n1,2');
    expect(result.contentType).toBe('text/csv');
  });
});
