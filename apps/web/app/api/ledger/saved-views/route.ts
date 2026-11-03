/**
 * `GET|POST /api/ledger/saved-views` — vistas guardadas del libro mayor.
 *
 * Al crear una vista, la consulta se normaliza con `parseLedgerQuery` (pasando
 * por `URLSearchParams`) para persistir sólo campos conocidos: nada de claves
 * arbitrarias del cliente en la base de datos.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { LedgerQueryDto, SavedLedgerViewResponse } from '@mybusiness/contracts';

import { parseLedgerQuery } from '@/lib/ledger/query';
import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAVED_VIEWS_PATH = '/api/v1/finance/ledger/saved-views';
const MAX_NAME_LENGTH = 100;

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

/** Copia sólo escalares a `URLSearchParams`; el parseo decide qué sobrevive. */
function toSearchParams(value: unknown): URLSearchParams {
  const params = new URLSearchParams();

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return params;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      params.set(key, entry);
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      params.set(key, String(entry));
    }
  }

  return params;
}

/** Normaliza la consulta guardada a la whitelist del contrato. */
function sanitizeQuery(value: unknown): LedgerQueryDto {
  return parseLedgerQuery(toSearchParams(value)) as LedgerQueryDto;
}

export async function GET(): Promise<NextResponse> {
  const session = await readSession();

  if (session === null) {
    return jsonError(401, 'session_required');
  }

  try {
    const views = await gatewayFetch<SavedLedgerViewResponse[]>(SAVED_VIEWS_PATH, {
      accessToken: session.accessToken,
    });

    return noStore(views);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
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

  const payload = await readJsonObject(request);

  if (payload === null) {
    return jsonError(400, 'invalid_payload');
  }

  const { name } = payload;

  if (typeof name !== 'string') {
    return jsonError(400, 'invalid_payload');
  }

  const trimmedName = name.trim();

  if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
    return jsonError(400, 'invalid_payload');
  }

  try {
    const view = await gatewayFetch<SavedLedgerViewResponse>(SAVED_VIEWS_PATH, {
      method: 'POST',
      body: { name: trimmedName, query: sanitizeQuery(payload.query) },
      accessToken: session.accessToken,
    });

    return noStore(view, 201);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
