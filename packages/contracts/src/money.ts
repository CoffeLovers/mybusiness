/**
 * Contrato monetario compartido. Los importes viajan como enteros en la
 * unidad mínima de la moneda (por ejemplo, centavos) serializados como string
 * para evitar pérdida de precisión en JSON. Ver ADR 003.
 */
export type CurrencyCode = string;

export interface Money {
  amountMinor: string;
  currency: CurrencyCode;
}

/** Entero decimal no negativo, sin separadores ni signo. */
export const MONEY_MINOR_PATTERN = /^\d+$/;

/** Código ISO 4217 en mayúsculas. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Límite de dígitos para mantener el valor dentro de BIGINT de PostgreSQL. */
export const MAX_MONEY_MINOR_DIGITS = 19;
