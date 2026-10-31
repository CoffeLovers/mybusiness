/**
 * `GET /api/session/csrf` — regenera el token CSRF de doble envío.
 *
 * El token vive en la cookie `mb_csrf` (legible por el cliente) y nunca se
 * devuelve en el cuerpo: el navegador debe leerlo de la cookie.
 */

import { NextResponse } from 'next/server';

import { CSRF_COOKIE, sessionCookieOptions } from '@/lib/session/cookies';
import { generateCsrfToken } from '@/lib/session/crypto';
import { readSession } from '@/lib/session/server';
import { getServerEnv } from '@/lib/server/env';
import { jsonError, noStore } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const { sessionSecret, secureCookies } = getServerEnv();
  const { maxAgeSeconds } = sessionCookieOptions(secureCookies);
  const response = noStore({ ok: true });

  response.cookies.set(CSRF_COOKIE, generateCsrfToken(sessionSecret, session.sessionId), {
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    httpOnly: false,
  });

  return response;
}
