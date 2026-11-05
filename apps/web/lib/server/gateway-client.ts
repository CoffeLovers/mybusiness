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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  cookie?: string;
}

/** Resultado crudo del gateway: cuerpo tipado y cabeceras `set-cookie`. */
export interface GatewayResponse<T> {
  data: T;
  setCookie: string[];
}

/** Respuesta no-JSON (exportaciones CSV) con sus cabeceras de entrega. */
export interface GatewayTextResponse {
  body: string;
  contentType: string | null;
  contentDisposition: string | null;
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
 * Desenvuelve el envelope que añade `TransformInterceptor` en el gateway
 * (`{ success: true, data: <payload> }`, #106). Sin esto el BFF entregaría el
 * sobre completo y los consumidores verían `undefined` en login/dashboard/ledger.
 *
 * Se mantiene tolerante para no romper mocks ni endpoints que responden plano:
 * si no hay envelope reconocible se devuelve el payload tal cual.
 */
function unwrapGatewayEnvelope<T>(payload: unknown): T {
  if (typeof payload !== 'object' || payload === null) {
    return payload as T;
  }

  const envelope = payload as { success?: unknown; data?: unknown };

  if (envelope.success === false) {
    // No se propaga el mensaje interno del gateway: sólo un código estable.
    throw new GatewayError(502, 'gateway_unsuccessful_response');
  }

  if (envelope.success === true && 'data' in envelope) {
    return envelope.data as T;
  }

  return payload as T;
}

/** Construye las cabeceras salientes a partir de `init`. */
function buildHeaders(init?: GatewayRequestInit): Record<string, string> {
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

  return headers;
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

  const response = await fetch(`${gatewayUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: buildHeaders(init),
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

  // #106: el gateway envuelve el payload en `{ success, data, timestamp }`.
  return { data: unwrapGatewayEnvelope<T>(await response.json()), setCookie };
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

/**
 * Ejecuta una petición al gateway que devuelve texto (CSV) sin intentar
 * parsearlo como JSON.
 *
 * Devuelve el cuerpo junto con las cabeceras de entrega para que el BFF pueda
 * reenviarlas tal cual. En caso de error nunca se propaga el cuerpo del
 * gateway: sólo un `GatewayError` con código estable.
 *
 * @throws GatewayError si la respuesta no es satisfactoria.
 */
export async function gatewayFetchText(
  path: string,
  init?: GatewayRequestInit,
): Promise<GatewayTextResponse> {
  const { gatewayUrl } = getServerEnv();

  const response = await fetch(`${gatewayUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: buildHeaders(init),
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

  const contentType = response.headers.get('content-type');
  const text = await response.text();

  return {
    body: unwrapTextEnvelope(text),
    contentType,
    contentDisposition: response.headers.get('content-disposition'),
  };
}

/**
 * Extrae el `data` string de un envelope JSON cuando el gateway ignora
 * `text/csv` y responde con el sobre habitual (#106). Si no aplica, devuelve
 * el texto original sin tocarlo.
 *
 * No se filtra por `content-type`: `TransformInterceptor` envuelve el cuerpo
 * pero el gateway conserva el `content-type` original (`text/csv`), así que el
 * sobre puede llegar con cualquier cabecera. Basta con que el cuerpo parezca
 * JSON y tenga la forma `{ success: true, data: string }`.
 */
function unwrapTextEnvelope(text: string): string {
  if (!text.trimStart().startsWith('{')) {
    return text;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { success?: unknown }).success === true &&
      typeof (parsed as { data?: unknown }).data === 'string'
    ) {
      return (parsed as { data: string }).data;
    }
  } catch {
    return text;
  }

  return text;
}
