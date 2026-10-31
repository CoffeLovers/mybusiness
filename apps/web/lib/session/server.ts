/**
 * Capa de sesión para Server Components y Route Handlers.
 *
 * Sólo se ejecuta en el servidor: las cookies httpOnly y los tokens del
 * gateway jamás cruzan al navegador salvo el token CSRF de doble envío.
 */

import 'server-only';

import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

import { getServerEnv } from '../server/env';
import { CSRF_COOKIE, SESSION_COOKIE } from './cookies';
import { generateCsrfToken, openSession, sealSession } from './crypto';
import { evaluateSession } from './policy';
import { requiresReauthentication } from './reauth';
import type { SessionRecord, SessionUser } from './types';

/** Vida de la cookie, alineada con la caducidad absoluta de la sesión. */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

/**
 * Lee la sesión activa de las cookies de la petición.
 * Devuelve `null` si no hay cookie, si no se puede abrir o si expiró.
 */
export async function readSession(): Promise<SessionRecord | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;

  if (value === undefined) {
    return null;
  }

  const session = openSession(value, getServerEnv().sessionSecret);

  if (session === null) {
    return null;
  }

  return evaluateSession(session).status === 'valid' ? session : null;
}

/** Alias legible de `readSession`; no lanza si no hay sesión. */
export async function requireSession(): Promise<SessionRecord | null> {
  return readSession();
}

/**
 * Sesión válida con actividad reciente (menos de 5 minutos).
 *
 * Devuelve `null` si no hay sesión o si requiere reautenticación; el llamador
 * decide el código de error y nunca se borran cookies desde aquí.
 */
export async function requireRecentSession(): Promise<SessionRecord | null> {
  const session = await readSession();

  if (session === null || requiresReauthentication(session)) {
    return null;
  }

  return session;
}

/** Escribe las cookies de sesión y CSRF en la respuesta. */
export function setSessionCookie(response: NextResponse, session: SessionRecord): void {
  const { sessionSecret: secret, secureCookies } = getServerEnv();
  const common = {
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };

  response.cookies.set(SESSION_COOKIE, sealSession(session, secret), {
    ...common,
    httpOnly: true,
  });
  response.cookies.set(CSRF_COOKIE, generateCsrfToken(secret, session.sessionId), {
    ...common,
    httpOnly: false,
  });
}

/** Elimina las cookies de sesión y CSRF de la respuesta. */
export function clearSessionCookies(response: NextResponse): void {
  const common = { path: '/', maxAge: 0 };

  response.cookies.set(SESSION_COOKIE, '', { ...common, httpOnly: true });
  response.cookies.set(CSRF_COOKIE, '', { ...common, httpOnly: false });
}

/** Cuerpo público de la sesión: sólo el usuario y la caducidad absoluta. */
export function sessionResponseBody(session: SessionRecord): {
  user: SessionUser;
  expiresAt: string;
} {
  return {
    user: session.user,
    expiresAt: new Date(session.issuedAt + SESSION_MAX_AGE_MS).toISOString(),
  };
}

/** Recupera el identificador de sesión para validar CSRF (sin comprobar expiración). */
export function sessionIdFrom(request: NextRequest): string | undefined {
  const value = request.cookies.get(SESSION_COOKIE)?.value;

  if (value === undefined) {
    return undefined;
  }

  return openSession(value, getServerEnv().sessionSecret)?.sessionId;
}
