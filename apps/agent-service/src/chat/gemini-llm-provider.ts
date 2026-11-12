import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeterministicLlmProvider,
  estimateTokens,
  LlmCompletion,
  LlmCompletionInput,
  LlmProvider,
  LlmProviderError,
} from './llm-provider';

export interface GeminiLlmProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fallbackProvider?: LlmProvider;
}

@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fallbackProvider: LlmProvider;

  constructor(config?: ConfigService, options?: GeminiLlmProviderOptions) {
    this.apiKey =
      options?.apiKey ?? config?.get<string>('GEMINI_API_KEY') ?? process.env.GEMINI_API_KEY;
    this.model =
      options?.model ??
      config?.get<string>('GEMINI_MODEL') ??
      process.env.GEMINI_MODEL ??
      'gemini-2.5-flash';
    this.timeoutMs = options?.timeoutMs ?? 10000;
    this.fallbackProvider =
      options?.fallbackProvider ?? new DeterministicLlmProvider({ mode: 'grounded' });
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY no configurada. Usando fallback determinista grounded.');
      return this.fallbackProvider.complete(input);
    }

    const factsPrompt =
      input.facts.length > 0
        ? input.facts
            .map((fact) => {
              const period = fact.period ? ` (${fact.period})` : '';
              const dataStr = fact.data ? JSON.stringify(fact.data) : '';
              return `- [${fact.source.toUpperCase()}] ${fact.label}${period}: ${dataStr}`;
            })
            .join('\n')
        : 'No hay hechos adicionales disponibles.';

    const systemInstruction = `Eres Financy, el asistente inteligente de voz y finanzas de MyBusiness.
Tu labor es responder con amabilidad, concisión y precisión financiera las dudas del usuario.
REGLAS CRÍTICAS:
1. Grounding Estricto: Usa ÚNICAMENTE las cifras, montos y fechas explícitas contenidas en los HECHOS VERIFICADOS.
2. Si te preguntan cifras no contenidas en los hechos, declara amablemente que no dispones de ese dato en el sistema.
3. No inventes transacciones ni balances.
4. Responde en español en tono natural, conciso y apto para ser leído por voz en la app móvil.`;

    const userContent = `Pregunta del usuario:
"${input.question}"

HECHOS VERIFICADOS DEL SISTEMA:
${factsPrompt}

Genera la respuesta financiera directa respetando las reglas de grounding.`;

    const modelsToTry = Array.from(
      new Set([this.model, 'gemini-2.5-flash-lite', 'gemini-flash-latest']),
    );

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: userContent }],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 800,
            },
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.warn(`Gemini (${model}) status ${response.status}: ${errorText}`);
          if (response.status === 503 || response.status === 429) {
            continue; // Reintentar con el siguiente modelo de menor carga
          }
          break;
        }

        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
        };

        const candidate = data.candidates?.[0];
        const answer = candidate?.content?.parts?.[0]?.text?.trim();

        if (!answer) {
          continue;
        }

        const promptTokens = data.usageMetadata?.promptTokenCount ?? estimateTokens(userContent);
        const completionTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokens(answer);

        return {
          answer,
          promptTokens,
          completionTokens,
        };
      } catch (err) {
        this.logger.warn(`Fallo al contactar Gemini (${model}): ${(err as Error).message}`);
      }
    }

    return this.fallbackProvider.complete(input);
  }
}
