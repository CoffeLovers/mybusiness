/**
 * Proveedor de LLM falso determinista.
 * Simula respuestas de modelos de lenguaje con llamadas a herramientas (function calling),
 * conteo exacto de tokens y emulación de fallos de red/proveedor sin claves reales.
 */

import type { ChatMessage, LLMResponse, ToolCall, ToolDefinition } from './types.ts';

export type FailureMode = 'none' | 'timeout' | 'http_503' | 'rate_limit_429';

export interface FakeLLMOptions {
  failureMode?: FailureMode;
  simulatedNetworkDelayMs?: number;
  timeoutThresholdMs?: number;
}

export class FakeLLMProvider {
  private failureMode: FailureMode;
  private networkDelayMs: number;
  private timeoutThresholdMs: number;

  constructor(options: FakeLLMOptions = {}) {
    this.failureMode = options.failureMode || 'none';
    this.networkDelayMs = options.simulatedNetworkDelayMs ?? 8;
    this.timeoutThresholdMs = options.timeoutThresholdMs ?? 2000;
  }

  public setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Estima los tokens de un texto o mensaje usando la heurística estándar
   * de 1 token ~ 4 caracteres en inglés / 3 caracteres en español técnico.
   */
  public estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 3.5));
  }

  /**
   * Procesa la llamada al modelo evaluando el historial de mensajes
   * y las herramientas disponibles.
   */
  public async generateChatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const start = Date.now();

    // 1. Emulación de fallos del proveedor
    if (this.failureMode === 'timeout') {
      await this.sleep(this.timeoutThresholdMs + 10);
      throw new Error(`LLM_TIMEOUT: El proveedor no respondió en ${this.timeoutThresholdMs} ms.`);
    }

    if (this.failureMode === 'http_503') {
      await this.sleep(Math.min(this.networkDelayMs, 10));
      throw new Error('LLM_HTTP_503: Service Unavailable (upstream model cluster overload).');
    }

    if (this.failureMode === 'rate_limit_429') {
      await this.sleep(Math.min(this.networkDelayMs, 5));
      throw new Error('LLM_RATE_LIMIT_429: Rate limit exceeded (TPM/RPM exceeded for tenant).');
    }

    // Retardo normal determinista
    await this.sleep(this.networkDelayMs);

    // 2. Cálculo de tokens de entrada (Prompt)
    let promptText = '';
    for (const msg of messages) {
      promptText += `${msg.role}:${msg.content || ''};`;
      if (msg.toolCalls) {
        promptText += JSON.stringify(msg.toolCalls);
      }
    }
    for (const tool of tools) {
      promptText += `${tool.name}:${tool.description}:${JSON.stringify(tool.parameters)};`;
    }
    const promptTokens = this.estimateTokens(promptText);

    // 3. Inspeccionar el último mensaje para determinar el paso
    const lastMessage = messages[messages.length - 1];
    const hasToolResponses = messages.some((m) => m.role === 'tool');

    // CASO A: Ya se ejecutaron herramientas -> Redactar respuesta final con cifras y citas
    if (hasToolResponses) {
      const toolMessages = messages.filter((m) => m.role === 'tool');

      // Escenario Multi-Herramienta (Cashflow + Unreconciled)
      if (toolMessages.length >= 2) {
        const reply =
          'Para el periodo de noviembre de 2026, su flujo de caja consolidado presenta ingresos de COP 48.500.000, egresos de COP 31.200.000 y un flujo neto positivo de COP 17.300.000 en 42 transacciones [get_cashflow_summary:2026-11-01..2026-11-30]. Adicionalmente, cuenta con 2 transacciones bancarias pendientes de conciliar por un total de COP 4.700.000 (PAGO FACTURA AWS CLOUD y COMPRA SUMINISTROS PAPELERIA S.A.S.) [list_unreconciled_transactions:tx-aws-001,tx-papeleria-002].';
        const completionTokens = this.estimateTokens(reply);

        return {
          message: {
            role: 'assistant',
            content: reply,
          },
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          latencyMs: Date.now() - start,
        };
      }

      // Escenario Saldo Simple
      const reply =
        'El saldo actual y disponible de su cuenta operativa (acc-operativa-001) en Banco de Bogotá es de COP 14.250.000 con corte al 03 de noviembre de 2026 [get_account_balance:acc-operativa-001].';
      const completionTokens = this.estimateTokens(reply);

      return {
        message: {
          role: 'assistant',
          content: reply,
        },
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: Date.now() - start,
      };
    }

    // CASO B: Primera llamada del usuario -> Generar tool calls deterministas
    const userPrompt = (lastMessage.content || '').toLowerCase();

    // ¿Es consulta multi-herramienta? (menciona flujo / cashflow Y conciliación / pendientes)
    if (
      (userPrompt.includes('flujo') || userPrompt.includes('cashflow')) &&
      (userPrompt.includes('concili') || userPrompt.includes('pendiente'))
    ) {
      const toolCalls: ToolCall[] = [
        {
          id: 'call_cf_001',
          type: 'function',
          function: {
            name: 'get_cashflow_summary',
            arguments: JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }),
          },
        },
        {
          id: 'call_tx_002',
          type: 'function',
          function: {
            name: 'list_unreconciled_transactions',
            arguments: JSON.stringify({ limit: 5 }),
          },
        },
      ];
      const completionTokens = this.estimateTokens(JSON.stringify(toolCalls));

      return {
        message: {
          role: 'assistant',
          content: null,
          toolCalls,
        },
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: Date.now() - start,
      };
    }

    // Por defecto: Consulta de saldo simple
    const toolCalls: ToolCall[] = [
      {
        id: 'call_bal_001',
        type: 'function',
        function: {
          name: 'get_account_balance',
          arguments: JSON.stringify({ accountId: 'acc-operativa-001' }),
        },
      },
    ];
    const completionTokens = this.estimateTokens(JSON.stringify(toolCalls));

    return {
      message: {
        role: 'assistant',
        content: null,
        toolCalls,
      },
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - start,
    };
  }
}
