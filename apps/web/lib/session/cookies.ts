/**
 * Nombres, opciones y utilidades de las cookies de sesión.
 *
 * Este módulo es deliberadamente puro: no importa `next/headers` ni toca el
 * runtime de Next, de modo que puede probarse de forma aislada. La lectura y
 * escritura real de cookies corresponde a las capas de route handlers.
 */

import type { SessionCookieOptions } from './types';

export const SESSION_COOKIE = 'mb_session';
export const CSRF_COOKIE = 'mb_csrf';
export const SESSION_COOKIE_VERSION = 'v1';

/** Vida de la cookie alineada con la caducidad absoluta de la sesión. */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Opciones de cookie derivadas del entorno: `secure` sólo en producción. */
export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return { secure, maxAgeSeconds: SESSION_MAX_AGE_SECONDS };
}

/** Normaliza el valor de la cookie: recorta espacios y trata el vacío como ausente. */
export function readSessionCookieValue(cookieValue: string | undefined): string | undefined {
  if (cookieValue === undefined) {
    return undefined;
  }

  const trimmed = cookieValue.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
