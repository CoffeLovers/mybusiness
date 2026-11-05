import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  AgentDegradationReason,
  type AgentChatCitation,
  type AgentChatDto,
  type AgentChatResponseDto,
  type AgentChatUsageDto,
  type McpToolName,
  type RequestContext,
} from '@mybusiness/contracts';
import { AgentService } from '../agent.service';
import { BudgetService } from '../budget/budget.service';
import { SemanticCacheService } from '../cache/semantic-cache.service';
import { McpToolsService } from '../mcp/mcp-tools.service';
import {
  LLM_PROVIDER,
  LlmProviderError,
  buildDeterministicAnswer,
  estimateTokens,
  type LlmCompletion,
  type LlmFact,
  type LlmProvider,
  type LlmProviderErrorCode,
} from './llm-provider';

/** Timeout por defecto de la conversación completa con el proveedor. */
export const DEFAULT_CHAT_TIMEOUT_MS = 8000;
/** Timeout por defecto de cada herramienta MCP y de la búsqueda en memoria. */
export const DEFAULT_TOOL_TIMEOUT_MS = 3000;

const MAX_MEMORY_TOP_K = 3;
const MAX_CITATION_LABEL_LENGTH = 160;
const MAX_ESTIMATED_COMPLETION_TOKENS = 1000;

/** Coincidencia de fechas ISO en el mensaje del usuario. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
/** Literal numérico (con separadores opcionales). */
const NUMERIC_LITERAL = /\d[\d.,]*/g;

const CASHFLOW_KEYWORDS = ['flujo de caja', 'cashflow', 'saldo', 'ingresos', 'egresos', 'balance'];
const RECONCILIATION_KEYWORDS = ['conciliaci', 'pendiente', 'sin conciliar', 'no conciliad'];

interface ResolvedPeriod {
  from: string;
  to: string;
  label: string;
  explicit: boolean;
}

/**
 * Canonicaliza un literal numérico para comparar cifras entre la respuesta del
 * LLM y los hechos: elimina símbolos de moneda y separadores de millar, y
 * unifica la coma decimal.
 */
function canonicalNumber(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) {
    return '';
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let decimalSeparator: ',' | '.' | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    const occurrences = cleaned.split(',').length - 1;
    const decimals = cleaned.length - lastComma - 1;
    decimalSeparator = occurrences > 1 || decimals === 3 ? null : ',';
  } else if (lastDot >= 0) {
    const occurrences = cleaned.split('.').length - 1;
    const decimals = cleaned.length - lastDot - 1;
    decimalSeparator = occurrences > 1 || decimals === 3 ? null : '.';
  }

  let normalized: string;
  if (decimalSeparator === ',') {
    normalized = `${cleaned.slice(0, lastComma).replace(/[.,]/g, '')}.${cleaned.slice(lastComma + 1).replace(/[.,]/g, '')}`;
  } else if (decimalSeparator === '.') {
    normalized = `${cleaned.slice(0, lastDot).replace(/[.,]/g, '')}.${cleaned.slice(lastDot + 1).replace(/[.,]/g, '')}`;
  } else {
    normalized = cleaned.replace(/[.,]/g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? String(value) : normalized;
}

/** Extrae el conjunto canónico de cifras presentes en un texto. */
function numericLiterals(text: string): Set<string> {
  const values = new Set<string>();
  const matches = text.match(NUMERIC_LITERAL) ?? [];
  for (const match of matches) {
    const canonical = canonicalNumber(match);
    if (canonical) {
      values.add(canonical);
    }
  }
  return values;
}

/**
 * Comprueba que toda cifra de la respuesta del LLM esté respaldada por los
 * hechos devueltos por las herramientas (grounding estricto).
 */
export function isGroundedAnswer(answer: string, corpus: string): boolean {
  const answerValues = numericLiterals(answer);
  if (answerValues.size === 0) {
    return true;
  }

  const corpusValues = numericLiterals(corpus);
  for (const value of answerValues) {
    if (!corpusValues.has(value)) {
      return false;
    }
  }
  return true;
}

function truncate(value: string, max = MAX_CITATION_LABEL_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly chatTimeoutMs: number;
  private readonly toolTimeoutMs: number;

  constructor(
    private readonly budgetService: BudgetService,
    private readonly cacheService: SemanticCacheService,
    private readonly mcpToolsService: McpToolsService,
    private readonly agentService: AgentService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProvider,
    private readonly config: ConfigService,
  ) {
    this.chatTimeoutMs = this.readTimeout('AGENT_CHAT_TIMEOUT_MS', DEFAULT_CHAT_TIMEOUT_MS);
    this.toolTimeoutMs = this.readTimeout('AGENT_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS);
  }

  /**
   * Conversación determinista sin streaming.
   *
   * El contexto multi-tenant (`tenantId`, `userId`, `role`) se toma siempre
   * del contexto RPC seguro; el DTO del usuario nunca aporta identidad.
   */
  async chat(ctx: RequestContext, dto: AgentChatDto): Promise<AgentChatResponseDto> {
    const tenantId = ctx?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }

    const message = dto?.message?.trim();
    if (!message) {
      throw new BadRequestException('El mensaje no puede estar vacío.');
    }

    const correlationId = randomUUID();
    const conversationId = dto.conversationId ?? correlationId;

    // 1. Caché semántica: atajo sin coste de tokens.
    const cached = await this.readCache(tenantId, message);
    if (cached) {
      return cached;
    }

    // 2. Reserva de presupuesto previa a cualquier consumo.
    const estimatedCostMicroUsd = this.budgetService.estimateCost(
      estimateTokens(message),
      MAX_ESTIMATED_COMPLETION_TOKENS,
    );
    const reservation = await this.budgetService.reserve({
      tenantId,
      correlationId,
      estimatedCostMicroUsd,
    });

    if (!reservation.granted) {
      const degraded = this.budgetService.handleDegradedResponse(
        AgentDegradationReason.BUDGET_EXHAUSTED,
        tenantId,
      );
      return {
        answer: degraded.message,
        citations: [],
        degraded: true,
        reason: AgentDegradationReason.BUDGET_EXHAUSTED,
        code: 'BUDGET_EXHAUSTED',
        usage: this.usage(0, 0, 0, reservation.remainingMicroUsd, false),
      };
    }

    // 3. Memoria semántica (opcional: su fallo no rompe la respuesta).
    const memories = await this.searchMemories(ctx, message);

    // 4. Herramientas MCP según el router determinista.
    const toolFacts: LlmFact[] = [];
    const citations: AgentChatCitation[] = [];
    let attemptedTools = 0;
    let failedTools = 0;

    for (const intent of this.route(message)) {
      const period = this.resolvePeriod(message, intent.tool);
      const args = this.buildToolArgs(intent.tool, period);
      attemptedTools += 1;

      try {
        const result = await this.withTimeout(
          this.mcpToolsService.call(intent.tool, args, {
            tenantId,
            userId: ctx.userId,
            role: ctx.role,
            requestId: correlationId,
          }),
          this.toolTimeoutMs,
        );

        toolFacts.push({
          source: 'tool',
          ref: intent.tool,
          tool: intent.tool,
          period: period.label,
          label: intent.label,
          args,
          data: result.data,
        });

        citations.push({
          source: 'tool',
          ref: intent.tool,
          tool: intent.tool,
          ...(period.label ? { period: period.label } : {}),
          label: intent.label,
        });
      } catch (error) {
        failedTools += 1;
        this.logger.warn(
          `Herramienta ${intent.tool} no disponible para tenant=${tenantId}: ${(error as Error).message}`,
        );
      }
    }

    for (const memory of memories) {
      citations.push({
        source: 'memory',
        ref: memory.id,
        label: truncate(memory.content),
      });
    }

    const facts: LlmFact[] = [
      ...toolFacts,
      ...memories.map((memory) => ({
        source: 'memory' as const,
        ref: memory.id,
        label: truncate(memory.content),
        data: undefined,
      })),
    ];

    // 4.b Todas las herramientas fallaron: no hay evidencia verificable, por
    // lo que la respuesta se degrada con un código estable en lugar de
    // devolver una respuesta sin fundamentar. La reserva se libera porque no
    // se consumen tokens del proveedor.
    if (attemptedTools > 0 && failedTools === attemptedTools) {
      this.logger.warn(
        `Todas las herramientas fallaron para tenant=${tenantId}: la respuesta se degrada`,
      );
      await this.budgetService.release({ tenantId, correlationId });
      return {
        answer: buildDeterministicAnswer(facts),
        citations,
        degraded: true,
        reason: AgentDegradationReason.PROVIDER_ERROR,
        code: 'ALL_TOOLS_FAILED',
        usage: this.usage(0, 0, 0, reservation.remainingMicroUsd, false),
      };
    }

    // 5. LLM determinista con timeout de conversación.
    let completion: LlmCompletion;
    try {
      completion = await this.withTimeout(
        this.llmProvider.complete({ question: message, facts }),
        this.chatTimeoutMs,
        'LLM_TIMEOUT',
      );
    } catch (error) {
      await this.budgetService.release({ tenantId, correlationId });
      const code =
        error instanceof LlmProviderError && error.code === 'LLM_TIMEOUT'
          ? 'LLM_TIMEOUT'
          : 'LLM_PROVIDER_ERROR';
      const degraded = this.budgetService.handleDegradedResponse(
        AgentDegradationReason.PROVIDER_ERROR,
        tenantId,
      );
      this.logger.warn(`Proveedor de LLM no disponible (${code}) para tenant=${tenantId}`);
      return {
        answer: degraded.message,
        citations,
        degraded: true,
        reason: AgentDegradationReason.PROVIDER_ERROR,
        code,
        usage: this.usage(0, 0, 0, reservation.remainingMicroUsd, false),
      };
    }

    // 6. Grounding estricto: toda cifra de la respuesta debe estar respaldada.
    const corpus = JSON.stringify(toolFacts.map((fact) => ({ args: fact.args, data: fact.data })));
    if (!isGroundedAnswer(completion.answer, corpus)) {
      this.logger.warn(
        `Respuesta del LLM descartada por grounding no verificable (tenant=${tenantId})`,
      );
      const actualCostMicroUsd = this.budgetService.calculateCost(
        completion.promptTokens,
        completion.completionTokens,
      );
      const settlement = await this.budgetService.settle({
        tenantId,
        correlationId,
        actualCostMicroUsd,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        conversationId,
        cacheHit: false,
        degraded: true,
      });

      return {
        answer: buildDeterministicAnswer(facts),
        citations,
        degraded: true,
        reason: AgentDegradationReason.PROVIDER_ERROR,
        code: 'LLM_UNGROUNDED_NUMBER',
        usage: this.usage(
          completion.promptTokens,
          completion.completionTokens,
          actualCostMicroUsd,
          settlement.remainingMicroUsd,
          false,
        ),
      };
    }

    // 7. Éxito: liquidar presupuesto, cachear y persistir memoria.
    const actualCostMicroUsd = this.budgetService.calculateCost(
      completion.promptTokens,
      completion.completionTokens,
    );
    const settlement = await this.budgetService.settle({
      tenantId,
      correlationId,
      actualCostMicroUsd,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      conversationId,
      cacheHit: false,
      degraded: false,
    });

    const response: AgentChatResponseDto = {
      answer: completion.answer,
      citations,
      degraded: false,
      usage: this.usage(
        completion.promptTokens,
        completion.completionTokens,
        actualCostMicroUsd,
        settlement.remainingMicroUsd,
        false,
      ),
    };

    await this.writeCache(tenantId, message, response);

    this.storeMemory(ctx, conversationId, message, completion.answer);

    return response;
  }

  private usage(
    promptTokens: number,
    completionTokens: number,
    costMicroUsd: number,
    budgetRemainingMicroUsd: number,
    cacheHit: boolean,
  ): AgentChatUsageDto {
    return {
      promptTokens,
      completionTokens,
      costMicroUsd,
      budgetRemainingMicroUsd,
      cacheHit,
    };
  }

  private readTimeout(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key, fallback);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * Router determinista por palabras clave. Sin LLM y sin aleatoriedad.
   */
  private route(message: string): Array<{ tool: McpToolName; label: string }> {
    const normalized = message.toLowerCase();
    const intents: Array<{ tool: McpToolName; label: string }> = [];

    if (CASHFLOW_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      intents.push({ tool: 'get_cashflow_summary', label: 'Resumen de flujo de caja' });
    }

    if (RECONCILIATION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      intents.push({
        tool: 'list_unreconciled_transactions',
        label: 'Transacciones pendientes de conciliación',
      });
    }

    return intents;
  }

  /**
   * Determina el periodo de análisis: fechas explícitas del mensaje o, en su
   * defecto, el mes UTC en curso.
   */
  private resolvePeriod(message: string, tool: McpToolName): ResolvedPeriod {
    const dates = message.match(ISO_DATE) ?? [];

    const first = dates[0];
    const second = dates[1];

    if (first !== undefined && second !== undefined) {
      const from = first <= second ? first : second;
      const to = first <= second ? second : first;
      return { from, to, label: `${from}/${to}`, explicit: true };
    }

    if (first !== undefined) {
      return { from: first, to: first, label: first, explicit: true };
    }

    const now = new Date();
    const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const to = now.toISOString().slice(0, 10);

    if (tool === 'list_unreconciled_transactions') {
      return { from, to, label: '', explicit: false };
    }

    return { from, to, label: `${from}/${to}`, explicit: false };
  }

  private buildToolArgs(tool: McpToolName, period: ResolvedPeriod): Record<string, unknown> {
    if (tool === 'get_cashflow_summary') {
      return { from: period.from, to: period.to };
    }

    if (period.explicit) {
      return { from: period.from, to: period.to };
    }

    return {};
  }

  /**
   * Búsqueda en memoria con timeout: si falla, la conversación continúa sin
   * memoria (degradación elegante, no error).
   */
  private async searchMemories(
    ctx: RequestContext,
    message: string,
  ): Promise<Array<{ id: string; content: string }>> {
    try {
      const response = await this.withTimeout(
        this.agentService.searchSimilar(ctx, { query: message, topK: MAX_MEMORY_TOP_K }),
        this.toolTimeoutMs,
      );

      return (response.results ?? []).map((result) => ({
        id: result.id,
        content: result.content,
      }));
    } catch (error) {
      this.logger.warn(
        `Memoria no disponible para tenant=${ctx.tenantId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async readCache(tenantId: string, message: string): Promise<AgentChatResponseDto | null> {
    try {
      const lookup = await this.cacheService.get(tenantId, message);
      if (!lookup.hit || !lookup.response) {
        return null;
      }

      const parsed = this.parseCachedResponse(lookup.response);
      if (!parsed) {
        return null;
      }

      return {
        ...parsed,
        usage: { ...parsed.usage, cacheHit: true },
      };
    } catch (error) {
      this.logger.warn(`Caché semántica no disponible: ${(error as Error).message}`);
      return null;
    }
  }

  private parseCachedResponse(raw: string): AgentChatResponseDto | null {
    try {
      const parsed = JSON.parse(raw) as Partial<AgentChatResponseDto>;
      if (typeof parsed?.answer !== 'string' || !parsed.answer) {
        return null;
      }

      return {
        answer: parsed.answer,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        degraded: parsed.degraded === true,
        reason: parsed.reason,
        code: parsed.code,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          costMicroUsd: 0,
          budgetRemainingMicroUsd: 0,
          cacheHit: false,
        },
      };
    } catch {
      return null;
    }
  }

  private async writeCache(
    tenantId: string,
    message: string,
    response: AgentChatResponseDto,
  ): Promise<void> {
    try {
      await this.cacheService.set(tenantId, message, JSON.stringify(response));
    } catch (error) {
      this.logger.warn(`No se pudo guardar la respuesta en caché: ${(error as Error).message}`);
    }
  }

  /**
   * Persistencia de memoria en segundo plano: nunca debe romper la respuesta.
   */
  private storeMemory(
    ctx: RequestContext,
    conversationId: string,
    message: string,
    answer: string,
  ): void {
    void this.agentService
      .storeMemory(ctx, {
        content: `Pregunta: ${message}\nRespuesta: ${answer}`,
        metadata: { conversationId, source: 'agent.chat' },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `No se pudo persistir la memoria de la conversación: ${(error as Error).message}`,
        );
      });
  }

  /**
   * Ejecuta una promesa con límite de tiempo. El error lanzado nunca incluye
   * datos del proveedor ni del tenant.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    code: LlmProviderErrorCode = 'LLM_PROVIDER_ERROR',
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new LlmProviderError(code, 'Tiempo de espera agotado'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
