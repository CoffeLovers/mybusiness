import { createHash } from 'node:crypto';

/**
 * Constantes y valores por defecto para gobernanza de tokens (SF3-03).
 * Cumple con ADR-003: todos los valores monetarios internos se manejan en micro-USD (1 USD = 1,000,000 micro-USD).
 */
export const BUDGET_CONSTANTS = {
  MICRO_USD_PER_USD: 1_000_000,
  DEFAULT_BUDGET_USD_MONTHLY: 50,
  DEFAULT_WARN_RATIO: 0.8,
  DEFAULT_HARD_LIMIT: true,
  DEFAULT_INPUT_COST_PER_1K_USD: 0.0015,
  DEFAULT_OUTPUT_COST_PER_1K_USD: 0.002,
  DEFAULT_CACHE_TTL_SECONDS: 86400,
  DEFAULT_CACHE_SIMILARITY_THRESHOLD: 0.95,
  DEFAULT_MODEL: 'gpt-4o-mini',
  EVENT_BUDGET_EXHAUSTED: 'agent.budget.exhausted',
} as const;

/**
 * Convierte un importe en USD a micro-USD enteros (ADR-003).
 */
export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * BUDGET_CONSTANTS.MICRO_USD_PER_USD);
}

/**
 * Convierte un importe en micro-USD a USD (para borde/reportes).
 */
export function microUsdToUsd(microUsd: number): number {
  return microUsd / BUDGET_CONSTANTS.MICRO_USD_PER_USD;
}

/**
 * Calcula la clave de período UTC en formato 'YYYY-MM'.
 */
export function getUtcPeriodKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Calcula el hash SHA-256 de un prompt para búsqueda exacta en caché semántica.
 */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex');
}

/**
 * Fórmula oficial de coste en micro-USD por llamada LLM (SF3-03).
 * Formula:
 *   promptCost = ceil((promptTokens * inputCostMicroUsdPer1k) / 1000)
 *   completionCost = ceil((completionTokens * outputCostMicroUsdPer1k) / 1000)
 *   total = promptCost + completionCost
 */
export function calculateTokenCostMicroUsd(
  promptTokens: number,
  completionTokens: number,
  inputCostMicroUsdPer1k: number,
  outputCostMicroUsdPer1k: number,
): number {
  const promptCost = Math.ceil((Math.max(0, promptTokens) * inputCostMicroUsdPer1k) / 1000);
  const completionCost = Math.ceil(
    (Math.max(0, completionTokens) * outputCostMicroUsdPer1k) / 1000,
  );
  return promptCost + completionCost;
}
