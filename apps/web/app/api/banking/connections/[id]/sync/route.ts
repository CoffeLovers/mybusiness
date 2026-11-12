/**
 * `POST /api/banking/connections/[id]/sync` — fuerza una sincronización de la
 * conexión bancaria.
 *
 * El identificador se valida localmente antes de llamar al gateway y la sesión
 * nunca sale del servidor. Los errores se traducen a códigos estables.
 */

import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

import type { SyncConnectionResponse } from '@mybusiness/contracts';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UUID genérico (cualquier versión): sólo forma, no semántica. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const guarded = guardMutation(request, session);

  if (guarded !== null) {
    return guarded;
  }

  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return jsonError(400, 'invalid_id');
  }

  try {
    const result = await gatewayFetch<SyncConnectionResponse>(
      `/api/v1/banking/connections/${encodeURIComponent(id)}/sync`,
      { method: 'POST', accessToken: session.accessToken },
    );

    return noStore(result);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
