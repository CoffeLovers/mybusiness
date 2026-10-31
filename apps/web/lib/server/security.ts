/**
 * Comprobaciones de seguridad para las rutas del BFF: origen permitido y CSRF
 * de doble envío ligado a la sesión.
 */

import type { NextRequest } from 'next/server';

import { CSRF_COOKIE } from '../session/cookies';
import { verifyCsrfToken } from '../session/crypto';

export const FORBIDDEN_CSRF = 'csrf_invalid';
export const FORBIDDEN_ORIGIN = 'origin_not_allowed';

/** Obtiene el origen de la petición, con `referer` como respaldo. */
function readOrigin(request: NextRequest): string | undefined {
  const origin = request.headers.get('origin');

  if (origin !== null && origin.length > 0) {
    return origin;
  }

  const referer = request.headers.get('referer');

  if (referer === null || referer.length === 0) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * Indica si el origen de la petición está en la lista permitida.
 * Los navegadores envían `Origin` en POST; sin origen ni `referer` se rechaza.
 */
export function isAllowedOrigin(request: NextRequest, allowedOrigins: string[]): boolean {
  const origin = readOrigin(request);

  if (origin === undefined) {
    return false;
  }

  return allowedOrigins.includes(origin);
}

/**
 * Valida el token CSRF del header contra el de la cookie y la sesión.
 */
export function hasValidCsrf(request: NextRequest, secret: string, sessionId: string): boolean {
  const headerToken = request.headers.get('x-csrf-token') ?? undefined;
  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;

  if (headerToken === undefined || cookieToken === undefined) {
    return false;
  }

  if (headerToken !== cookieToken) {
    return false;
  }

  return verifyCsrfToken(headerToken, secret, sessionId);
}
