/**
 * `POST /api/banking/exchange` — canjea el `public_token` de Plaid Link por una
 * conexión bancaria persistida en el gateway.
 *
 * El `public_token` es efímero y sólo se reenvía al gateway junto con la
 * identidad de la sesión. La respuesta nunca se cachea porque describe estado
 * recién creado.
 */

import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

import type { BankConnectionResponse } from '@mybusiness/contracts';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proveedores que el portal web sabe canjear hoy. */
const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(['plaid']);

/** Los `public_token` de Plaid son cortos; el límite evita cuerpos abusivos. */
const MAX_PUBLIC_TOKEN_LENGTH = 255;

/** Lee el cuerpo como objeto plano; `null` si no es JSON de objeto. */
async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await request.json();

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return null;
    }

    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const guarded = guardMutation(request, session);

  if (guarded !== null) {
    return guarded;
  }

  const body = await readJsonObject(request);
  const provider = body?.provider;
  const publicToken = body?.publicToken;

  if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.has(provider)) {
    return jsonError(400, 'invalid_provider');
  }

  if (
    typeof publicToken !== 'string' ||
    publicToken.trim().length === 0 ||
    publicToken.length > MAX_PUBLIC_TOKEN_LENGTH
  ) {
    return jsonError(400, 'invalid_public_token');
  }

  try {
    const result = await gatewayFetch<BankConnectionResponse>('/api/v1/banking/exchange', {
      method: 'POST',
      body: { provider, publicToken },
      accessToken: session.accessToken,
    });

    return noStore(result);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
