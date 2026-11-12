/**
 * `POST /api/agent/chat` — proxy del chat del asistente.
 *
 * El cuerpo se reduce a `message` y `conversationId` opcional: cualquier otra
 * clave se descarta. La sesión y el token de acceso nunca salen del servidor.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { AgentChatResponseDto } from '@mybusiness/contracts';

import { GatewayError, gatewayFetch } from '@/lib/server/gateway-client';
import { guardMutation, jsonError, noStore } from '@/lib/server/route-helpers';
import { readSession } from '@/lib/session/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONVERSATION_ID_LENGTH = 120;

interface ChatBody {
  message: string;
  conversationId?: string;
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

/** Valida y recorta el cuerpo del chat. */
function parseChatBody(payload: Record<string, unknown>): ChatBody | null {
  const { message, conversationId } = payload;

  if (
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }

  if (conversationId === undefined) {
    return { message };
  }

  if (
    typeof conversationId !== 'string' ||
    conversationId.length === 0 ||
    conversationId.length > MAX_CONVERSATION_ID_LENGTH
  ) {
    return null;
  }

  return { message, conversationId };
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
  const body = payload === null ? null : parseChatBody(payload);

  if (body === null) {
    return jsonError(400, 'invalid_payload');
  }

  try {
    const response = await gatewayFetch<AgentChatResponseDto>('/api/v1/agent/chat', {
      method: 'POST',
      body,
      accessToken: session.accessToken,
    });

    return noStore(response);
  } catch (error) {
    if (error instanceof GatewayError) {
      return jsonError(error.status, error.code);
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
