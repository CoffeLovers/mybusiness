/**
 * `POST /api/session/refresh` — rota el access token conservando la sesión.
 *
 * La caducidad absoluta (`issuedAt`) no se renueva: el refresh sólo extiende la
 * inactividad. Un fallo del gateway invalida la sesión local.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clearSessionCookies, readSession, setSessionCookie } from '@/lib/session/server';
import type { SessionRecord, SessionUser } from '@/lib/session/types';
import { GatewayError, gatewayFetchWithHeaders } from '@/lib/server/gateway-client';
import { extractCookie, guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFRESH_COOKIE = 'mybusiness_refresh_token';

interface RefreshResult {
  accessToken: string;
  user: SessionUser;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readSession();
  const guarded = guardMutation(request, session, { session });

  if (guarded !== null) {
    return guarded;
  }

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  try {
    const { data, setCookie } = await gatewayFetchWithHeaders<RefreshResult>(
      '/api/v1/auth/refresh',
      { method: 'POST', body: { refreshToken: session.refreshToken } },
    );

    const rotated = extractCookie(setCookie, REFRESH_COOKIE) ?? session.refreshToken;
    const next: SessionRecord = {
      ...session,
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: rotated,
      lastSeenAt: Date.now(),
    };

    const response = noStore({ user: next.user });
    setSessionCookie(response, next);

    return response;
  } catch (error) {
    if (error instanceof GatewayError) {
      const response = jsonError(401, 'session_expired');
      clearSessionCookies(response);

      return response;
    }

    return jsonError(502, 'gateway_error');
  }
}
