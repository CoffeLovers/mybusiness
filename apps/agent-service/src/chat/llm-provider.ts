import { Injectable } from '@nestjs/common';
import type { McpToolName } from '@mybusiness/contracts';

/**
 * Token de inyección del proveedor de LLM.
 *
 * Solo existe una implementación (`DeterministicLlmProvider`): el agente
 * conversacional de SF3-02 no hace llamadas de red ni usa credenciales.
 */
export const LLM_PROVIDER = 'LLM_PROVIDER';

/** Códigos estables de error del proveedor (no filtran mensajes del proveedor). */
export type LlmProviderErrorCode = 'LLM_TIMEOUT' | 'LLM_PROVIDER_ERROR' | 'LLM_INVALID_RESPONSE';

export class LlmProviderError extends Error {
  constructor(
    readonly code: LlmProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/** Hecho verificable entregado al proveedor como contexto. */
export interface LlmFact {
  source: 'tool' | 'memory';
  ref: string;
  tool?: McpToolName;
  period?: string;
  label: string;
  /** Argumentos de la herramienta (parte de la evidencia para el grounding). */
  args?: Record<string, unknown>;
  /** Datos devueltos por la herramienta. */
  data?: unknown;
}

export interface LlmCompletionInput {
  question: string;
  facts: LlmFact[];
}

export interface LlmCompletion {
  answer: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmProvider {
  complete(input: LlmCompletionInput): Promise<LlmCompletion>;
}

export type DeterministicLlmMode = 'grounded' | 'garbage';

export interface DeterministicLlmProviderOptions {
  /** `grounded` (por defecto) redacta usando solo los hechos; `garbage` inventa cifras. */
  mode?: DeterministicLlmMode;
  /** Retardo artificial en milisegundos (simula latencia o timeout). */
  delayMs?: number;
}

/** Etiquetas en español para las magnitudes conocidas de las herramientas. */
const FACT_LABELS: Record<string, string> = {
  balanceMinor: 'saldo',
  incomeMinor: 'ingresos',
  expenseMinor: 'egresos',
  burnRateMinor: 'ritmo de quema',
  runwayMonths: 'meses de runway',
  total: 'total',
  count: 'total',
  currency: 'moneda',
};

const TOOL_LABELS: Record<string, string> = {
  get_cashflow_summary: 'flujo de caja',
  list_unreconciled_transactions: 'transacciones pendientes de conciliación',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Estimación determinista de tokens (≈ 4 caracteres por token).
 * Se usa para liquidar el presupuesto sin depender de un tokenizer externo.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

function isNumericValue(value: unknown): value is number | string {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && /^\d+$/.test(value);
}

/**
 * Extrae las magnitudes verificables de un hecho de herramienta.
 * Solo se exponen claves conocidas para no filtrar ruido del proveedor.
 */
export function summarizeFactData(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === 'currency' && typeof value === 'string') {
      parts.push(`moneda ${value}`);
      continue;
    }

    if (!(key in FACT_LABELS) || !isNumericValue(value)) {
      continue;
    }

    parts.push(`${FACT_LABELS[key]} ${value}`);
  }

  return parts;
}

/**
 * Construye una respuesta determinista en español usando únicamente los hechos
 * de herramientas. Si no hay hechos, declara que no puede confirmar cifras.
 *
 * La función es compartida entre el proveedor determinista y el camino
 * degradado por grounding fallido, de modo que ambos producen el mismo texto.
 */
export function buildDeterministicAnswer(facts: LlmFact[]): string {
  const toolFacts = facts.filter((fact) => fact.source === 'tool');

  if (toolFacts.length === 0) {
    return (
      'No puedo confirmar cifras sin consultar las herramientas de datos. ' +
      'Intente de nuevo o revise el módulo de Finanzas y Conciliación.'
    );
  }

  const sentences = toolFacts.map((fact) => {
    const label = TOOL_LABELS[fact.tool ?? ''] ?? fact.label;
    const summary = summarizeFactData(fact.data).join(', ');
    const period = fact.period ? ` (${fact.period})` : '';
    const detail = summary ? `: ${summary}` : '';
    return `${label}${period}${detail}`;
  });

  const hasMemory = facts.some((fact) => fact.source === 'memory');
  const memoryNote = hasMemory ? ' Se ha considerado también la memoria previa del tenant.' : '';

  return `${sentences.join('. ')}.${memoryNote}`;
}

/**
 * Proveedor de LLM determinista y sin red.
 *
 * - `grounded`: responde solo con los hechos recibidos.
 * - `garbage`: inventa cifras (existe para verificar el control de grounding).
 * - `delayMs`: introduce latencia para verificar el manejo de timeouts.
 */
@Injectable()
export class DeterministicLlmProvider implements LlmProvider {
  private readonly mode: DeterministicLlmMode;
  private readonly delayMs: number;

  constructor(options: DeterministicLlmProviderOptions = {}) {
    this.mode = options.mode ?? 'grounded';
    this.delayMs = options.delayMs ?? 0;
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }

    const answer =
      this.mode === 'garbage'
        ? this.buildFabricatedAnswer(input)
        : buildDeterministicAnswer(input.facts);

    if (!answer.trim()) {
      throw new LlmProviderError('LLM_INVALID_RESPONSE', 'Respuesta vacía del proveedor');
    }

    return {
      answer,
      promptTokens: estimateTokens(input.question),
      completionTokens: estimateTokens(answer),
    };
  }

  /**
   * Inventa cifras deliberadamente incompatibles con los hechos: sirve para
   * demostrar que el grounding estricto descarta la respuesta del LLM.
   */
  private buildFabricatedAnswer(input: LlmCompletionInput): string {
    const period = input.facts.find((fact) => fact.source === 'tool')?.period;
    const suffix = period ? ` del periodo ${period}` : '';
    return (
      `El flujo de caja${suffix} fue de 9876543 USD, con ingresos de 7654321 USD ` +
      'y egresos de 654321 USD. El saldo del periodo es de 5555555 USD.'
    );
  }
}
