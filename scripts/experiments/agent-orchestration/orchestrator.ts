/**
 * Orquestador determinista propio para agentes financieros (CustomAgentOrchestrator).
 * Implementa el ciclo ReAct acotado (LLM -> Tools -> LLM), timeout por herramienta,
 * degradación controlada ante fallos del modelo y observabilidad estructurada (OpenTelemetry).
 */

import { FakeLLMProvider } from './fake-llm-provider.ts';
import type {
  ChatMessage,
  LLMUsage,
  OrchestrationResult,
  Span,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './types.ts';

export interface OrchestratorOptions {
  provider: FakeLLMProvider;
  tools: ToolDefinition[];
  maxTurns?: number;
  overallTimeoutMs?: number;
}

export class CustomAgentOrchestrator {
  private provider: FakeLLMProvider;
  private toolsMap: Map<string, ToolDefinition>;
  private toolsList: ToolDefinition[];
  private maxTurns: number;
  private overallTimeoutMs: number;

  constructor(options: OrchestratorOptions) {
    this.provider = options.provider;
    this.toolsList = options.tools;
    this.toolsMap = new Map(options.tools.map((t) => [t.name, t]));
    this.maxTurns = options.maxTurns ?? 3;
    this.overallTimeoutMs = options.overallTimeoutMs ?? 5000;
  }

  /**
   * Ejecuta una herramienta con control de timeout estricto por herramienta.
   */
  private async executeToolWithTimeout(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult<unknown>> {
    const timeoutPromise = new Promise<ToolResult<unknown>>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          error: {
            code: 'TOOL_TIMEOUT',
            message: `La herramienta '${tool.name}' superó el tiempo límite de ${tool.timeoutMs}ms`,
            retryable: true,
          },
          executionTimeMs: tool.timeoutMs,
          citation: `${tool.name}: timeout`,
        });
      }, tool.timeoutMs);
    });

    return Promise.race([tool.execute(args, ctx), timeoutPromise]);
  }

  /**
   * Ejecuta un turno conversacional completo.
   */
  public async handleTurn(userPrompt: string, ctx: ToolContext): Promise<OrchestrationResult> {
    const overallStart = Date.now();
    const spans: Span[] = [];
    const citations: Set<string> = new Set();
    let toolCallsCount = 0;

    const totalTokens: LLMUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Eres el asistente financiero de MyBusiness. NUNCA calcules sumas ni saldos: utiliza siempre las herramientas proporcionadas y cita explícitamente los datos devueltos.',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    try {
      // 1. Primer paso: Invocación inicial al LLM
      const llmStart1 = Date.now();
      const llmRes1 = await this.provider.generateChatCompletion(messages, this.toolsList);
      const llmEnd1 = Date.now();

      spans.push({
        name: 'agent.llm_call',
        startTimeMs: llmStart1,
        endTimeMs: llmEnd1,
        durationMs: llmEnd1 - llmStart1,
        attributes: {
          'llm.step': 1,
          'llm.prompt_tokens': llmRes1.usage.promptTokens,
          'llm.completion_tokens': llmRes1.usage.completionTokens,
          'tenant.id': ctx.tenantId,
        },
      });

      totalTokens.promptTokens += llmRes1.usage.promptTokens;
      totalTokens.completionTokens += llmRes1.usage.completionTokens;
      totalTokens.totalTokens += llmRes1.usage.totalTokens;

      messages.push(llmRes1.message);

      // Si el modelo no pidió herramientas, devolvemos respuesta directa
      if (!llmRes1.message.toolCalls || llmRes1.message.toolCalls.length === 0) {
        const totalDurationMs = Date.now() - overallStart;
        return {
          content: llmRes1.message.content || '',
          citations: Array.from(citations),
          toolCallsCount: 0,
          totalDurationMs,
          totalTokens,
          estimatedCostUSD: this.calculateCostUSD(totalTokens),
          spans,
        };
      }

      // 2. Ejecución concurrente de herramientas solicitadas
      const toolPromises = llmRes1.message.toolCalls.map(async (toolCall) => {
        const toolDef = this.toolsMap.get(toolCall.function.name);
        const toolStart = Date.now();

        if (!toolDef) {
          const errRes: ToolResult<unknown> = {
            success: false,
            error: {
              code: 'TOOL_NOT_FOUND',
              message: `Herramienta ${toolCall.function.name} no registrada.`,
              retryable: false,
            },
            executionTimeMs: 1,
            citation: 'tool_not_found',
          };
          return { toolCall, result: errRes, durationMs: 1 };
        }

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          parsedArgs = {};
        }

        const result = await this.executeToolWithTimeout(toolDef, parsedArgs, ctx);
        const toolEnd = Date.now();
        const durationMs = toolEnd - toolStart;

        spans.push({
          name: 'agent.tool_call',
          startTimeMs: toolStart,
          endTimeMs: toolEnd,
          durationMs,
          attributes: {
            'tool.name': toolDef.name,
            'tool.success': result.success,
            'audit.action': toolDef.auditAction,
            'tenant.id': ctx.tenantId,
          },
        });

        return { toolCall, result, durationMs };
      });

      const toolResults = await Promise.all(toolPromises);
      toolCallsCount += toolResults.length;

      for (const { toolCall, result } of toolResults) {
        if (result.citation) {
          citations.add(result.citation);
        }
        messages.push({
          role: 'tool',
          name: toolCall.function.name,
          toolCallId: toolCall.id,
          content: JSON.stringify(result.success ? result.data : result.error),
        });
      }

      // 3. Segundo paso: Síntesis final con LLM
      const llmStart2 = Date.now();
      const llmRes2 = await this.provider.generateChatCompletion(messages, this.toolsList);
      const llmEnd2 = Date.now();

      spans.push({
        name: 'agent.llm_call',
        startTimeMs: llmStart2,
        endTimeMs: llmEnd2,
        durationMs: llmEnd2 - llmStart2,
        attributes: {
          'llm.step': 2,
          'llm.prompt_tokens': llmRes2.usage.promptTokens,
          'llm.completion_tokens': llmRes2.usage.completionTokens,
          'tenant.id': ctx.tenantId,
        },
      });

      totalTokens.promptTokens += llmRes2.usage.promptTokens;
      totalTokens.completionTokens += llmRes2.usage.completionTokens;
      totalTokens.totalTokens += llmRes2.usage.totalTokens;

      const totalDurationMs = Date.now() - overallStart;

      return {
        content: llmRes2.message.content || '',
        citations: Array.from(citations),
        toolCallsCount,
        totalDurationMs,
        totalTokens,
        estimatedCostUSD: this.calculateCostUSD(totalTokens),
        spans,
      };
    } catch (err: unknown) {
      // 4. Manejo de fallos con degradación controlada (Fallback seguro sin fuga de secretos)
      const durationMs = Date.now() - overallStart;
      const rawError = err instanceof Error ? err.message : String(err);
      const isTimeout = rawError.includes('LLM_TIMEOUT');
      const isRateLimit = rawError.includes('429');
      const errorCode = isTimeout
        ? 'MODEL_TIMEOUT'
        : isRateLimit
          ? 'MODEL_RATE_LIMIT'
          : 'MODEL_UNAVAILABLE';

      spans.push({
        name: 'agent.failure_fallback',
        startTimeMs: overallStart,
        endTimeMs: Date.now(),
        durationMs,
        attributes: {
          'error.code': errorCode,
          'error.degraded': true,
          'tenant.id': ctx.tenantId,
        },
      });

      return {
        content:
          'En este momento el servicio inteligente de procesamiento presenta alta demanda o indisponibilidad temporal. Sus registros financieros permanecen íntegros y puede consultar los balances directamente en las tablas del portal.',
        citations: [],
        toolCallsCount,
        totalDurationMs: durationMs,
        totalTokens,
        estimatedCostUSD: this.calculateCostUSD(totalTokens),
        spans,
        error: {
          code: errorCode,
          message: 'Fallo controlado del proveedor de IA con degradación a mensaje seguro.',
          degraded: true,
        },
      };
    }
  }

  /**
   * Cálculo de costes estándar basado en modelo de referencia GPT-4o-mini:
   * - $0.15 / 1,000,000 prompt tokens
   * - $0.60 / 1,000,000 completion tokens
   */
  private calculateCostUSD(usage: LLMUsage): number {
    const inputCost = (usage.promptTokens / 1_000_000) * 0.15;
    const outputCost = (usage.completionTokens / 1_000_000) * 0.6;
    return Number((inputCost + outputCost).toFixed(7));
  }
}
