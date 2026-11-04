/**
 * `PATCH /api/ledger/[id]` — edita categoría y notas de un movimiento.
 *
 * El identificador se valida localmente antes de llamar al gateway y el cuerpo
 * se limita a los campos editables: cualquier otra clave se descarta para no
 * reenviar datos arbitrarios. La sesión nunca sale del servidor.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { LedgerRowResponse } from '@mybusiness/contracts';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UUID genérico (cualquier versión): sólo forma, no semántica. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CATEGORY_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;

interface PatchLedgerBody {
  category?: string;
  notes?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
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

/** Extrae sólo `category`/`notes` válidos; exige al menos uno presente. */
function parsePatchBody(payload: Record<string, unknown>): PatchLedgerBody | null {
  const body: PatchLedgerBody = {};
  const { category, notes } = payload;

  if (category !== undefined) {
    if (typeof category !== 'string' || category.length > MAX_CATEGORY_LENGTH) {
      return null;
    }

    body.category = category;
  }

  if (notes !== undefined) {
    if (typeof notes !== 'string' || notes.length > MAX_NOTES_LENGTH) {
      return null;
    }

    body.notes = notes;
  }

  return body.category === undefined && body.notes === undefined ? null : body;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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

  const payload = await readJsonObject(request);
  const body = payload === null ? null : parsePatchBody(payload);

  if (body === null) {
    return jsonError(400, 'invalid_payload');
  }

  try {
    const row = await gatewayFetch<LedgerRowResponse>(
      `/api/v1/finance/ledger/${encodeURIComponent(id)}`,
      { method: 'PATCH', body, accessToken: session.accessToken },
    );

    return noStore(row);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
