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

/** Error de formato monetario: nunca expone valores del proveedor. */
export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = MoneyFormatError.name;
  }
}

/**
 * Escala decimal de una moneda según ISO 4217. Se deriva de los datos de
 * localización de `Intl.NumberFormat` (mismo origen que la capa de
 * presentación) en lugar de duplicar una tabla manual por servicio (ADR 003).
 */
export function currencyScaleOf(currency: string): number {
  try {
    const format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    });
    return format.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Moneda no reconocida por ICU: se asume la escala estándar de 2 decimales.
    return 2;
  }
}

/**
 * Convierte un importe entero en unidad mínima al formato decimal del
 * proveedor de pagos (p.ej. `"25000"` + `"COP"` → `"250.00"`, `4` + `"JPY"`
 * → `4`). Es la única función autorizada para serializar importes hacia
 * PayPal; rechaza strings no enteros y monedas inválidas (ADR 003).
 */
export function minorToPayPalDecimal(amountMinor: string, currency: string): string {
  if (typeof amountMinor !== 'string' || !MONEY_MINOR_PATTERN.test(amountMinor)) {
    throw new MoneyFormatError('amountMinor debe ser un entero decimal no negativo');
  }

  if (typeof currency !== 'string' || !CURRENCY_CODE_PATTERN.test(currency)) {
    throw new MoneyFormatError('currency debe ser un código ISO 4217 de 3 letras');
  }

  const scale = currencyScaleOf(currency);
  const padded = amountMinor.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);

  if (scale === 0) {
    return intPart;
  }

  const fracPart = padded.slice(padded.length - scale);
  return `${intPart}.${fracPart}`;
}

/**
 * Inverso autorizado de `minorToPayPalDecimal`: convierte el decimal del
 * proveedor (`"250.00"` + `"COP"` → `"25000"`, `"4750"` + `"JPY"` → `"4750"`)
 * al entero en unidad mínima. La normalización es exacta para las escalas de
 * la moneda; rechaza decimales con más dígitos que la escala de la moneda,
 * separadores, signos y notación científica (ADR 003, usado por los webhooks
 * de SF3-09 que traen el importe en el formato del proveedor).
 */
export function payPalDecimalToMinor(value: string, currency: string): string {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) {
    throw new MoneyFormatError('El importe del proveedor no es un decimal válido');
  }

  if (typeof currency !== 'string' || !CURRENCY_CODE_PATTERN.test(currency)) {
    throw new MoneyFormatError('currency debe ser un código ISO 4217 de 3 letras');
  }

  const scale = currencyScaleOf(currency);
  const [intPart, fracPart = ''] = value.split('.');
  if (fracPart.length > scale) {
    throw new MoneyFormatError('El importe del proveedor excede la escala de la moneda');
  }

  return `${intPart}${fracPart.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '');
}
