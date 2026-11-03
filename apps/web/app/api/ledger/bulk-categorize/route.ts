/**
 * `POST /api/ledger/bulk-categorize` — recategoriza varios movimientos.
 *
 * El lote se acota a 500 identificadores y todos deben ser UUID válidos: así el
 * BFF rechaza pronto lo que el gateway rechazaría y evita trabajo inútil.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UUID genérico (cualquier versión): sólo forma, no semántica. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BULK_ROWS = 500;
const MAX_CATEGORY_LENGTH = 200;

interface BulkCategorizeBody {
  ids: string[];
  category: string;
}

interface BulkCategorizeResult {
  updated: number;
  requested: number;
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

/** Valida el cuerpo; distingue el exceso de filas del resto de errores. */
function parseBulkBody(
  payload: Record<string, unknown>,
): { body: BulkCategorizeBody } | { error: 'too_many_rows' | 'invalid_payload' } {
  const { ids, category } = payload;

  if (!Array.isArray(ids) || ids.length === 0) {
    return { error: 'invalid_payload' };
  }

  if (ids.length > MAX_BULK_ROWS) {
    return { error: 'too_many_rows' };
  }

  if (!ids.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) {
    return { error: 'invalid_payload' };
  }

  if (typeof category !== 'string') {
    return { error: 'invalid_payload' };
  }

  const trimmedCategory = category.trim();

  if (trimmedCategory.length === 0 || trimmedCategory.length > MAX_CATEGORY_LENGTH) {
    return { error: 'invalid_payload' };
  }

  return { body: { ids, category: trimmedCategory } };
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

  const payload = await readJsonObject(request);
  const parsed = payload === null ? null : parseBulkBody(payload);

  if (parsed === null) {
    return jsonError(400, 'invalid_payload');
  }

  if ('error' in parsed) {
    return jsonError(400, parsed.error);
  }

  try {
    const result = await gatewayFetch<BulkCategorizeResult>(
      '/api/v1/finance/ledger/bulk-categorize',
      { method: 'POST', body: parsed.body, accessToken: session.accessToken },
    );

    return noStore(result);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
