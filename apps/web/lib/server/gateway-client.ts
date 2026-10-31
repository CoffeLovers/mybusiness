/**
 * Cliente HTTP mínimo hacia el gateway de la API.
 *
 * Centraliza el manejo de errores para que las rutas del BFF nunca propaguen
 * el cuerpo completo ni credenciales hacia el cliente.
 */

import { getServerEnv } from './env';

const TIMEOUT_MS = 8000;

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'GatewayError';
  }
}

export interface GatewayRequestInit {
  method?: 'GET' | 'POST';
  body?: unknown;
  accessToken?: string;
  cookie?: string;
}

/** Resultado crudo del gateway: cuerpo tipado y cabeceras `set-cookie`. */
export interface GatewayResponse<T> {
  data: T;
  setCookie: string[];
}

/** Extrae un código de error estable del cuerpo de una respuesta fallida. */
function readErrorCode(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return 'gateway_error';
  }

  const record = payload as { message?: unknown; error?: unknown };
  const candidate = record.message ?? record.error;

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'gateway_error';
}

/**
 * Ejecuta una petición al gateway y devuelve el JSON tipado junto con las
 * cabeceras `set-cookie` que haya emitido (necesarias para rotar el refresh
 * token, que nunca sale del servidor).
 *
 * @throws GatewayError si la respuesta no es satisfactoria.
 */
export async function gatewayFetchWithHeaders<T>(
  path: string,
  init?: GatewayRequestInit,
): Promise<GatewayResponse<T>> {
  const { gatewayUrl } = getServerEnv();
  const headers: Record<string, string> = {};

  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (init?.accessToken !== undefined) {
    headers['authorization'] = `Bearer ${init.accessToken}`;
  }

  if (init?.cookie !== undefined) {
    headers['cookie'] = init.cookie;
  }

  const response = await fetch(`${gatewayUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!response.ok) {
    let code = 'gateway_error';

    try {
      code = readErrorCode(await response.json());
    } catch {
      code = 'gateway_error';
    }

    throw new GatewayError(response.status, code);
  }

  const setCookie = response.headers.getSetCookie();

  if (response.status === 204) {
    return { data: undefined as T, setCookie };
  }

  return { data: (await response.json()) as T, setCookie };
}

/**
 * Ejecuta una petición al gateway y devuelve sólo el JSON tipado.
 *
 * @throws GatewayError si la respuesta no es satisfactoria.
 */
export async function gatewayFetch<T>(path: string, init?: GatewayRequestInit): Promise<T> {
  const { data } = await gatewayFetchWithHeaders<T>(path, init);

  return data;
}
