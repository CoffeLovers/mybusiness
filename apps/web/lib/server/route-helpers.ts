/**
 * Utilidades compartidas por los Route Handlers del BFF.
 *
 * Centralizan tres invariantes: ninguna respuesta se cachea, los errores
 * exponen códigos estables (nunca mensajes del gateway) y toda mutación se
 * valida contra origen permitido + CSRF de doble envío ligado a la sesión.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { SessionRecord } from '../session/types';
import { getServerEnv } from './env';
import { FORBIDDEN_CSRF, FORBIDDEN_ORIGIN, hasValidCsrf, isAllowedOrigin } from './security';

const NO_STORE = 'no-store';

/** Respuesta de error con código estable y sin caché. */
export function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json(
    { error: code, status },
    { status, headers: { 'cache-control': NO_STORE } },
  );
}

/** Respuesta JSON que nunca debe almacenarse en cachés intermedias. */
export function noStore<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': NO_STORE } });
}

/**
 * Valida una mutación del BFF.
 *
 * - `session` omitido: no aplica CSRF (login, logout sin sesión).
 * - `session` `null`: el llamador ya resolvió que no hay sesión -> 401.
 * - `session` presente: CSRF obligatorio.
 *
 * El tercer argumento permite declarar explícitamente la sesión resuelta sin
 * depender de la posición del segundo parámetro.
 *
 * @returns `null` si la petición puede continuar; si no, la respuesta de error.
 */
export function guardMutation(
  request: NextRequest,
  session?: SessionRecord | null,
  options: { session?: SessionRecord | null } = {},
): NextResponse | null {
  const { sessionSecret, allowedOrigins } = getServerEnv();

  if (!isAllowedOrigin(request, allowedOrigins)) {
    return jsonError(403, FORBIDDEN_ORIGIN);
  }

  const explicit = options.session !== undefined;
  const resolved = explicit ? options.session : session;

  if (resolved === null || resolved === undefined) {
    // Sólo es un error cuando el llamador afirmó explícitamente que no hay sesión.
    return explicit || session !== undefined ? jsonError(401, 'session_required') : null;
  }

  if (!hasValidCsrf(request, sessionSecret, resolved.sessionId)) {
    return jsonError(403, FORBIDDEN_CSRF);
  }

  return null;
}

/**
 * Extrae el valor de una cookie de un array `set-cookie`.
 *
 * Busca la primera entrada que empiece por `name=` y devuelve el valor
 * decodificado hasta el primer `;`. Devuelve `undefined` si no existe o si la
 * codificación es inválida.
 */
export function extractCookie(setCookie: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const header = setCookie.find((entry) => entry.startsWith(prefix));

  if (header === undefined) {
    return undefined;
  }

  const rawValue = header.slice(prefix.length).split(';')[0]?.trim();

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}
