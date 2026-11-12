/**
 * `GET /api/agent/budget` — presupuesto del agente para el periodo actual.
 *
 * Sólo lectura: reenvía el `accessToken` de la sesión y devuelve el snapshot
 * sin caché. Los errores del gateway se traducen a códigos estables.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { AgentBudgetSnapshot } from '@mybusiness/contracts';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  try {
    const budget = await gatewayFetch<AgentBudgetSnapshot>('/api/v1/agent/budget', {
      accessToken: session.accessToken,
    });

    return noStore(budget);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
