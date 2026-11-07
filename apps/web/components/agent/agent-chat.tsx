'use client';

/**
 * Panel del agente conversacional (SF3-05, #75; SF4-01, #54).
 *
 * El chat vive en el cliente: el mensaje del usuario se pinta de inmediato y la
 * respuesta del BFF se consume de forma incremental vía SSE (`ReadableStream`).
 * Las cifras de consumo y el presupuesto restante provienen siempre de `usage`,
 * nunca se estiman en el navegador.
 */

import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { Button, Chip, StatusBadge } from '@/components/ui';
import { formatMinorUnitsString } from '@/lib/format';

/** Cookie CSRF de doble envío (la única legible por el cliente). */
const CSRF_COOKIE = 'mb_csrf';

const SUGGESTIONS = [
  '¿Cuál es mi saldo?',
  'Resumen de flujo de caja del mes',
  'Movimientos sin conciliar',
] as const;

interface Citation {
  source: 'tool' | 'memory';
  ref: string;
  tool?: string;
  period?: string;
  label?: string;
}

interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  costMicroUsd: number;
  budgetRemainingMicroUsd: number;
  cacheHit: boolean;
}

interface ChatResponse {
  answer: string;
  citations: Citation[];
  degraded: boolean;
  reason?: string;
  code?: string;
  usage: ChatUsage;
}

export interface BudgetSnapshot {
  limitMicroUsd: number;
  spentMicroUsd: number;
  availableMicroUsd: number;
}

type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      citations: Citation[];
      degraded: boolean;
      reason?: string;
      usage: ChatUsage;
    };

interface BudgetView {
  limitMicroUsd: number | null;
  spentMicroUsd: number | null;
  remainingMicroUsd: number;
}

export interface AgentChatProps {
  initialBudget: BudgetSnapshot | null;
  budgetError: boolean;
}

type StreamStatus = 'idle' | 'connecting' | 'tool' | 'generating' | 'cancelled' | 'fallback';

/** Código de error estable del BFF, nunca el cuerpo remoto. */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { error?: unknown }).error === 'string'
    ) {
      return (payload as { error: string }).error;
    }
  } catch {
    // Respuesta sin JSON: se usa el código HTTP.
  }

  return `http_${String(response.status)}`;
}

/** Lee una cookie no httpOnly; `undefined` si no existe o está vacía. */
function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  const rawValue = match?.[1];

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie(CSRF_COOKIE);

  return token === undefined ? {} : { 'x-csrf-token': token };
}

/** Micro-USD (entero) a texto monetario: 1 USD = 1.000.000 micro-USD. */
function formatMicroUsd(microUsd: number): string {
  const cents = Math.trunc(Math.max(0, microUsd) / 10_000);

  return formatMinorUnitsString(String(cents), 'USD');
}

/** Presupuesto como barra: porcentaje consumido acotado a 0–100. */
function consumedPercent(budget: BudgetView): number {
  if (budget.limitMicroUsd === null || budget.limitMicroUsd <= 0) {
    return 0;
  }

  const spent = budget.spentMicroUsd ?? 0;

  return Math.min(100, Math.max(0, Math.round((spent / budget.limitMicroUsd) * 100)));
}

function isChatResponse(value: unknown): value is ChatResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ChatResponse>;

  return (
    typeof candidate.answer === 'string' &&
    Array.isArray(candidate.citations) &&
    typeof candidate.degraded === 'boolean' &&
    typeof candidate.usage === 'object' &&
    candidate.usage !== null &&
    typeof candidate.usage.budgetRemainingMicroUsd === 'number'
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const kind = citation.source === 'tool' ? 'Herramienta' : 'Memoria';
  const primary = citation.label ?? citation.ref;
  const meta = [citation.tool, citation.period].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  return (
    <li>
      <Chip className="max-w-full whitespace-normal">
        <span className="font-semibold">{kind}</span>
        <span aria-hidden="true">·</span>
        <span className="break-words">{primary}</span>
        {meta.length > 0 ? <span className="text-text-muted">({meta.join(' · ')})</span> : null}
      </Chip>
    </li>
  );
}

export function AgentChat({ initialBudget, budgetError }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [budget, setBudget] = useState<BudgetView | null>(
    initialBudget === null
      ? null
      : {
          limitMicroUsd: initialBudget.limitMicroUsd,
          spentMicroUsd: initialBudget.spentMicroUsd,
          remainingMicroUsd: initialBudget.availableMicroUsd,
        },
  );

  const nextId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  const makeId = (role: 'user' | 'assistant'): string => {
    nextId.current += 1;

    return `${role}-${String(nextId.current)}`;
  };

  /** Ejecuta el chat estándar no-streaming como fallback resiliente. */
  const submitFallback = async (message: string, assistantId: string): Promise<void> => {
    setStreamStatus('fallback');
    setFallbackNotice(true);

    const response = await fetch('/api/agent/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(await readErrorCode(response));
    }

    const payload: unknown = await response.json();

    if (!isChatResponse(payload)) {
      throw new Error('invalid_response');
    }

    setMessages((current) =>
      current.map((msg) =>
        msg.id === assistantId
          ? {
              id: assistantId,
              role: 'assistant',
              content: payload.answer,
              citations: payload.citations,
              degraded: payload.degraded,
              ...(payload.reason === undefined ? {} : { reason: payload.reason }),
              usage: payload.usage,
            }
          : msg,
      ),
    );

    const remaining = Math.max(0, payload.usage.budgetRemainingMicroUsd);
    setBudget((current) => {
      const limit = current?.limitMicroUsd ?? null;

      return {
        limitMicroUsd: limit,
        spentMicroUsd: limit === null ? null : Math.max(0, limit - remaining),
        remainingMicroUsd: remaining,
      };
    });
  };

  const submit = async (rawMessage: string, appendUser = true): Promise<void> => {
    const message = rawMessage.trim();

    if (message.length === 0 || pending) {
      return;
    }

    if (appendUser) {
      setMessages((current) => [
        ...current,
        { id: makeId('user'), role: 'user', content: message },
      ]);
    }

    const assistantId = makeId('assistant');
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: [],
        degraded: false,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          costMicroUsd: 0,
          budgetRemainingMicroUsd: budget?.remainingMicroUsd ?? 0,
          cacheHit: false,
        },
      },
    ]);

    setInput('');
    setError(null);
    setLastFailed(null);
    setFallbackNotice(false);
    setPending(true);
    setStreamStatus('connecting');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...csrfHeaders(),
      };
      if (lastEventIdRef.current) {
        headers['last-event-id'] = lastEventIdRef.current;
      }

      const response = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';

      // Si el stream falla al iniciar o no es SSE, recurrir al endpoint estándar.
      if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
        if (!controller.signal.aborted) {
          await submitFallback(message, assistantId);
          return;
        }
      }

      if (!response.body) {
        throw new Error('empty_body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';
        let currentData = '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) {
            if (currentData.length > 0) {
              try {
                const parsed = JSON.parse(currentData) as Record<string, unknown>;

                if (currentEvent === 'tool') {
                  const toolName = typeof parsed.tool === 'string' ? parsed.tool : null;
                  const status = parsed.status === 'start' ? 'tool' : 'generating';
                  setStreamStatus(status);
                  setActiveTool(status === 'tool' ? toolName : null);
                } else if (currentEvent === 'token') {
                  const delta =
                    typeof parsed.delta === 'string'
                      ? parsed.delta
                      : typeof parsed.token === 'string'
                        ? parsed.token
                        : '';
                  setStreamStatus('generating');
                  setMessages((current) =>
                    current.map((msg) =>
                      msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg,
                    ),
                  );
                } else if (currentEvent === 'citation') {
                  const citation = (parsed.citation ?? parsed) as Citation;
                  if (citation && typeof citation.ref === 'string') {
                    setMessages((current) =>
                      current.map((msg) => {
                        if (msg.role !== 'assistant' || msg.id !== assistantId) return msg;
                        const exists = msg.citations.some((c: Citation) => c.ref === citation.ref);
                        if (exists) return msg;
                        return { ...msg, citations: [...msg.citations, citation] };
                      }),
                    );
                  }
                } else if (currentEvent === 'done') {
                  const finalUsage = parsed.usage as ChatUsage | undefined;
                  const degraded = Boolean(parsed.degraded);
                  const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;

                  setMessages((current) =>
                    current.map((msg) => {
                      if (msg.role !== 'assistant' || msg.id !== assistantId) return msg;
                      return {
                        ...msg,
                        degraded,
                        ...(reason ? { reason } : {}),
                        ...(finalUsage ? { usage: finalUsage } : {}),
                      };
                    }),
                  );

                  if (finalUsage) {
                    const remaining = Math.max(0, finalUsage.budgetRemainingMicroUsd);
                    setBudget((current) => {
                      const limit = current?.limitMicroUsd ?? null;
                      return {
                        limitMicroUsd: limit,
                        spentMicroUsd: limit === null ? null : Math.max(0, limit - remaining),
                        remainingMicroUsd: remaining,
                      };
                    });
                  }

                  setStreamStatus('idle');
                  setActiveTool(null);
                } else if (currentEvent === 'error') {
                  const code = typeof parsed.code === 'string' ? parsed.code : 'stream_error';
                  throw new Error(code);
                }
              } catch (e) {
                if (e instanceof Error && e.name !== 'SyntaxError') {
                  throw e;
                }
              }
              currentData = '';
            }
            continue;
          }

          if (trimmed.startsWith('id:')) {
            const id = trimmed.slice(3).trim();
            lastEventIdRef.current = id;
          } else if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const dataPart = trimmed.slice(5).trim();
            currentData = currentData.length === 0 ? dataPart : `${currentData}\n${dataPart}`;
          }
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        setStreamStatus('cancelled');
        setMessages((current) =>
          current.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content:
                    msg.content.length === 0
                      ? '(Consulta cancelada por el usuario)'
                      : `${msg.content} (cancelado por el usuario)`,
                }
              : msg,
          ),
        );
        return;
      }

      setError(cause instanceof Error && cause.message.length > 0 ? cause.message : 'error');
      setLastFailed(message);
      // Limpiar mensaje vacío del asistente si falló antes de emitir nada
      setMessages((current) =>
        current.filter((msg) => !(msg.id === assistantId && msg.content.length === 0)),
      );
    } finally {
      setPending(false);
      abortControllerRef.current = null;
      setActiveTool(null);
    }
  };

  const handleCancel = (): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submit(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(input);
    }
  };

  const percent = budget === null ? 0 : consumedPercent(budget);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Presupuesto del agente"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4"
      >
        {budget === null ? (
          <p className="text-sm text-text-muted">
            {budgetError ? 'Presupuesto no disponible.' : 'Sin presupuesto cargado.'}
          </p>
        ) : budget.limitMicroUsd === null || budget.spentMicroUsd === null ? (
          <p className="text-sm text-text">
            Restante:{' '}
            <span className="tabular-nums">{formatMicroUsd(budget.remainingMicroUsd)}</span>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">Presupuesto del periodo</h2>
              <p className="text-sm text-text tabular-nums">
                {formatMicroUsd(budget.spentMicroUsd)} / {formatMicroUsd(budget.limitMicroUsd)}
              </p>
            </div>
            <div
              role="progressbar"
              aria-label="Presupuesto consumido"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${String(percent)}% consumido`}
              className="h-2 w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${String(percent)}%` }}
              />
            </div>
            <p className="text-sm text-text-muted">
              Restante:{' '}
              <span className="tabular-nums text-text">
                {formatMicroUsd(budget.remainingMicroUsd)}
              </span>
            </p>
          </>
        )}
      </section>

      {fallbackNotice ? (
        <div className="flex items-center gap-2">
          <StatusBadge tone="alert">Canal estándar (streaming no disponible)</StatusBadge>
        </div>
      ) : null}

      <div role="log" aria-live="polite" aria-busy={pending} className="flex flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
            <p className="text-sm text-text-muted">Prueba con una de estas consultas:</p>
            <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                    }}
                    className="flex min-h-11 items-center rounded-md border border-border-strong bg-surface px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) =>
              message.role === 'user' ? (
                <li key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-primary px-4 py-2 text-sm text-on-primary">
                    <span className="sr-only">Tú: </span>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                </li>
              ) : (
                <li key={message.id} className="flex flex-col gap-2">
                  <div className="max-w-prose rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-text">
                    <span className="sr-only">Agente: </span>
                    <p className="whitespace-pre-wrap break-words">
                      {message.content.length > 0 ? message.content : '…'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {message.degraded ? (
                      <StatusBadge tone="alert">
                        Modo degradado{message.reason !== undefined ? `: ${message.reason}` : ''}
                      </StatusBadge>
                    ) : null}
                    {message.citations.length > 0 ? (
                      <ul aria-label="Fuentes" className="flex flex-wrap gap-2">
                        {message.citations.map((citation, index) => (
                          <CitationChip
                            key={`${message.id}-citation-${String(index)}`}
                            citation={citation}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {message.usage.promptTokens + message.usage.completionTokens > 0 ? (
                    <p className="text-xs text-text-muted">
                      {message.usage.promptTokens + message.usage.completionTokens} tokens ·{' '}
                      {formatMicroUsd(message.usage.costMicroUsd)} ·{' '}
                      {message.usage.cacheHit ? 'caché' : 'sin caché'}
                    </p>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        )}

        {pending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5">
            <p className="text-sm text-text-muted" aria-busy="true">
              {streamStatus === 'connecting'
                ? 'Conectando con el asistente…'
                : streamStatus === 'tool'
                  ? `Consultando herramienta (${activeTool ?? 'en curso'})…`
                  : 'Generando respuesta…'}
            </p>
            <Button type="button" variant="secondary" onClick={handleCancel} className="text-xs">
              Cancelar
            </Button>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-alert/40 bg-surface-raised px-4 py-3"
        >
          <p className="text-sm text-text">
            No se pudo obtener la respuesta. Comprueba la conexión e inténtalo de nuevo.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              if (lastFailed !== null) {
                void submit(lastFailed, false);
              }
            }}
            disabled={pending || lastFailed === null}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="agent-message" className="text-sm font-medium text-text">
          Mensaje para el agente
        </label>
        <textarea
          id="agent-message"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={4000}
          placeholder="Escribe tu consulta. Enter envía, Shift+Enter añade una línea."
          className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-text-muted">Enter envía · Shift+Enter añade una línea</p>
          <Button type="submit" disabled={input.trim().length === 0 || pending} loading={pending}>
            Enviar
          </Button>
        </div>
      </form>
    </div>
  );
}
