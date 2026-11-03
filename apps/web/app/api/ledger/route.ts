/**
 * `GET /api/ledger` — página del libro mayor.
 *
 * La sesión nunca sale del servidor: el BFF añade el access token y reenvía la
 * consulta ya normalizada al gateway. Los errores se traducen a códigos
 * estables sin filtrar mensajes remotos.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { LedgerPageResponse } from '@mybusiness/contracts';

import { ledgerQueryToSearchParams, parseLedgerQuery } from '@/lib/ledger/query';
import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const query = parseLedgerQuery(new URL(request.url).searchParams);

  try {
    const data = await gatewayFetch<LedgerPageResponse>(
      `/api/v1/finance/ledger?${ledgerQueryToSearchParams(query).toString()}`,
      { accessToken: session.accessToken },
    );

    return noStore(data);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
