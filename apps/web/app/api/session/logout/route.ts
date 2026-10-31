/**
 * `POST /api/session/logout` — cierra la sesión local y avisa al gateway.
 *
 * Con `?all=true` revoca todas las sesiones del usuario; si el gateway falla no
 * se borran las cookies locales. Sin `all` el cierre es idempotente: sin sesión
 * válida igualmente limpia las cookies y un fallo remoto no lo impide.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clearSessionCookies, readSession, requireRecentSession } from '@/lib/session/server';
import type { SessionRecord } from '@/lib/session/types';
import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LogoutAllResult {
  success: true;
  revoked: number;
}

interface RefreshResult {
  accessToken: string;
}

/** Solicita al gateway la revocación global usando un access token. */
function requestLogoutAll(accessToken: string): Promise<LogoutAllResult> {
  return gatewayFetch<LogoutAllResult>('/api/v1/auth/logout-all', {
    method: 'POST',
    accessToken,
  });
}

/** Rota el access token a partir del refresh token; `null` si no es posible. */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const refreshed = await gatewayFetch<RefreshResult>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });

    return refreshed.accessToken;
  } catch {
    return null;
  }
}

/** Revocación global: si falla, no se limpia la sesión local. */
async function logoutEverywhere(session: SessionRecord): Promise<NextResponse> {
  let accessToken = session.accessToken;

  try {
    const result = await requestLogoutAll(accessToken);
    const response = noStore<LogoutAllResult>(result);
    clearSessionCookies(response);

    return response;
  } catch (error) {
    if (!(error instanceof GatewayError) || error.status !== 401) {
      return jsonError(502, 'global_logout_failed');
    }
  }

  const refreshed = await refreshAccessToken(session.refreshToken);

  if (refreshed === null) {
    return jsonError(502, 'global_logout_failed');
  }

  accessToken = refreshed;

  try {
    const result = await requestLogoutAll(accessToken);
    const response = noStore<LogoutAllResult>(result);
    clearSessionCookies(response);

    return response;
  } catch {
    return jsonError(502, 'global_logout_failed');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const globalLogout = request.nextUrl.searchParams.get('all') === 'true';

  if (globalLogout) {
    const recentSession = await requireRecentSession();

    if (recentSession === null) {
      // Cierre global: operación sensible, exige actividad reciente (CSRF/origen
      // se validan después). Sin cookies borradas: la sesión sigue siendo válida.
      return jsonError(403, 'reauth_required');
    }

    const guarded = guardMutation(request, recentSession, { session: recentSession });

    if (guarded !== null) {
      return guarded;
    }

    return logoutEverywhere(recentSession);
  }

  const session = await readSession();

  const guarded = guardMutation(request, session ?? undefined);

  if (guarded !== null) {
    return guarded;
  }

  if (session !== null) {
    try {
      await gatewayFetch('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
    } catch {
      // Best effort: la revocación remota no bloquea el cierre local.
    }
  }

  const response = noStore({ success: true });
  clearSessionCookies(response);

  return response;
}
