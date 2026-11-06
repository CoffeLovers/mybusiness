/**
 * `POST /api/banking/link-token` — acuña un `link_token` de Plaid.
 *
 * El token es de un solo uso y caduca pronto, así que la respuesta viaja
 * siempre sin caché. La sesión y las credenciales del proveedor nunca salen del
 * servidor: el BFF sólo reenvía el proveedor solicitado.
 */

import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proveedores que el portal web sabe abrir hoy. */
const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(['plaid']);

export interface LinkTokenResponse {
  linkToken: string;
  expiration?: string;
}

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

  if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.has(provider)) {
    return jsonError(400, 'invalid_provider');
  }

  try {
    const result = await gatewayFetch<LinkTokenResponse>('/api/v1/banking/link-token', {
      method: 'POST',
      body: { provider },
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
