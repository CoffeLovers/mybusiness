/**
 * `POST /api/agent/chat/stream` — proxy SSE del chat del asistente (SF4-01).
 *
 * El cuerpo se reduce a `message` y `conversationId` opcional. Reexpone el
 * flujo de eventos del gateway como ReadableStream (SSE) al navegador,
 * propagando `Last-Event-ID` y cancelando aguas arriba vía AbortSignal.
 */

import type { NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/server/env';
import { guardMutation, jsonError } from '@/lib/server/route-helpers';
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

export async function POST(request: NextRequest): Promise<Response> {
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

  const { gatewayUrl } = getServerEnv();
  const targetUrl = `${gatewayUrl}/api/v1/agent/chat/stream`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'text/event-stream',
  };

  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) {
    headers['Last-Event-ID'] = lastEventId;
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return jsonError(upstreamResponse.status, `gateway_error_${upstreamResponse.status}`);
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }

    return jsonError(502, 'gateway_unavailable');
  }
}
