/**
 * `POST /api/session/login` — establece la sesión del BFF.
 *
 * Los tokens del gateway permanecen en el servidor: el navegador sólo recibe
 * la cookie cifrada de sesión y el usuario público.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { generateId } from '@/lib/session/crypto';
import { setSessionCookie } from '@/lib/session/server';
import type { SessionRecord, SessionUser } from '@/lib/session/types';
import { GatewayError, gatewayFetchWithHeaders } from '@/lib/server/gateway-client';
import { extractCookie, guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cookie que el gateway emite con el refresh token (Path `/api/v1/auth`). */
const REFRESH_COOKIE = 'mybusiness_refresh_token';

interface LoginResult {
  accessToken: string;
  user: SessionUser;
}

/** Valida la forma del cuerpo sin confiar en ningún campo adicional. */
function readCredentials(payload: unknown): { email: string; password: string } | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { email, password } = payload as { email?: unknown; password?: unknown };

  if (typeof email !== 'string' || typeof password !== 'string') {
    return null;
  }

  const normalizedEmail = email.trim();

  if (normalizedEmail.length === 0 || password.length === 0 || !normalizedEmail.includes('@')) {
    return null;
  }

  return { email: normalizedEmail, password };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarded = guardMutation(request);

  if (guarded !== null) {
    return guarded;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'invalid_credentials_shape');
  }

  const credentials = readCredentials(payload);

  if (credentials === null) {
    return jsonError(400, 'invalid_credentials_shape');
  }

  try {
    const { data, setCookie } = await gatewayFetchWithHeaders<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      body: credentials,
    });

    const refreshToken = extractCookie(setCookie, REFRESH_COOKIE);

    if (refreshToken === undefined) {
      return jsonError(502, 'gateway_missing_refresh_token');
    }

    const now = Date.now();
    const session: SessionRecord = {
      version: 1,
      sessionId: generateId(),
      deviceId: request.headers.get('x-device-id')?.slice(0, 64) || generateId(),
      user: data.user,
      accessToken: data.accessToken,
      refreshToken,
      issuedAt: now,
      lastSeenAt: now,
    };

    const response = noStore({ user: session.user });
    setSessionCookie(response, session);

    return response;
  } catch (error) {
    if (error instanceof GatewayError) {
      if (error.status === 401) {
        return jsonError(401, 'invalid_credentials');
      }

      if (error.status === 429) {
        return jsonError(429, 'too_many_attempts');
      }
    }

    return jsonError(502, 'gateway_error');
  }
}
