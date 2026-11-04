/**
 * `DELETE /api/ledger/saved-views/[id]` — elimina una vista guardada.
 *
 * Operación idempotente desde la perspectiva del cliente: el gateway decide si
 * la vista existía. La respuesta 204 nunca se cachea.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UUID genérico (cualquier versión): sólo forma, no semántica. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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
    await gatewayFetch<void>(`/api/v1/finance/ledger/saved-views/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken: session.accessToken,
    });

    return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
