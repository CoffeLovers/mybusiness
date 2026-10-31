/**
 * `GET /api/session/me` — usuario actual de la sesión del BFF.
 *
 * Aplica sliding idle: refresca `lastSeenAt` y vuelve a sellar la cookie.
 */

import { NextResponse } from 'next/server';

import { touchSession } from '@/lib/session/policy';
import { readSession, sessionResponseBody, setSessionCookie } from '@/lib/session/server';
import { jsonError, noStore } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const touched = touchSession(session);
  const response = noStore(sessionResponseBody(touched));
  setSessionCookie(response, touched);

  return response;
}
