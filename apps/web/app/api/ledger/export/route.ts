/**
 * `GET /api/ledger/export` — descarga CSV del libro mayor.
 *
 * Reenvía las cabeceras de entrega del gateway (`content-type` y
 * `content-disposition`) para que el navegador guarde el archivo con el nombre
 * correcto; si faltan, se usan valores por defecto seguros.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ledgerQueryToSearchParams, parseLedgerQuery } from '@/lib/ledger/query';
import { GatewayError, gatewayFetchText } from '@/lib/server/gateway-client';
import { jsonError } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_CONTENT_TYPE = 'text/csv; charset=utf-8';
const DEFAULT_CONTENT_DISPOSITION = 'attachment; filename="libro-mayor.csv"';
const CSV_BOM = '\uFEFF';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  const query = parseLedgerQuery(new URL(request.url).searchParams);

  try {
    const { body, contentType, contentDisposition } = await gatewayFetchText(
      `/api/v1/finance/ledger/export.csv?${ledgerQueryToSearchParams(query).toString()}`,
      { accessToken: session.accessToken },
    );

    // `Response.text()` descarta el BOM inicial; se garantiza de nuevo para que
    // Excel y otras hojas de cálculo detecten UTF-8 al abrir el archivo.
    const payload = body.startsWith(CSV_BOM) ? body : `${CSV_BOM}${body}`;

    return new NextResponse(payload, {
      headers: {
        'content-type': contentType ?? DEFAULT_CONTENT_TYPE,
        'content-disposition': contentDisposition ?? DEFAULT_CONTENT_DISPOSITION,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
