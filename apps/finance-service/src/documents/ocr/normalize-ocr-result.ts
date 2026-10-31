import type { OcrExtraction, OcrLineItem } from './ocr-provider.interface';

/**
 * Convierte un importe decimal a su representación en unidades menores (céntimos)
 * como cadena de dígitos sin signo. Acepta números finitos y cadenas con coma o
 * punto decimal, eliminando separadores de miles (`1.234,56` y `1,234.56`).
 *
 * El redondeo es half-up a 2 decimales y se resuelve con enteros (BigInt), por lo
 * que no hay pérdida de precisión en el resultado final. El separador decimal es
 * el último `.` o `,` que aparece; el resto de separadores se consideran de miles.
 */
export function parseDecimalToMinor(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    const absolute = Math.abs(value);
    // Fuera de este rango los enteros de unidades menores dejan de ser seguros.
    if (absolute >= 1e21) {
      return null;
    }
    return decimalStringToMinor(absolute.toFixed(20));
  }

  if (typeof value === 'string') {
    return decimalStringToMinor(value);
  }

  return null;
}

function decimalStringToMinor(raw: string): string | null {
  let text = raw.replace(/\s+/g, '');
  if (text === '') {
    return null;
  }

  // El contrato devuelve un entero sin signo: se descarta el signo de entrada.
  if (text.startsWith('+') || text.startsWith('-')) {
    text = text.slice(1);
  }

  if (!/^[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) {
    return null;
  }

  const decimalIndex = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  const integerRaw = decimalIndex === -1 ? text : text.slice(0, decimalIndex);
  const fractionRaw = decimalIndex === -1 ? '' : text.slice(decimalIndex + 1);

  const integerPart = integerRaw.replace(/[.,]/g, '') || '0';
  const fractionPart = fractionRaw.replace(/[.,]/g, '');

  if (!/^[0-9]+$/.test(integerPart) || !/^[0-9]*$/.test(fractionPart)) {
    return null;
  }

  const fraction = `${fractionPart}000`;
  const cents = BigInt(fraction.slice(0, 2));
  const thirdDecimal = Number(fraction[2]);
  const roundedCents = thirdDecimal >= 5 ? 1n : 0n;

  const minor = BigInt(integerPart) * 100n + cents + roundedCents;
  return minor.toString();
}

/** Normaliza `YYYY-MM-DD`, `DD/MM/YYYY` y `DD-MM-YYYY` a ISO `YYYY-MM-DD`. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoMatch) {
    return buildIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const dayFirstMatch = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  if (dayFirstMatch) {
    return buildIsoDate(
      Number(dayFirstMatch[3]),
      Number(dayFirstMatch[2]),
      Number(dayFirstMatch[1]),
    );
  }

  return null;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!isRealDate) {
    return null;
  }

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

/** Código ISO 4217 de tres letras en mayúsculas; cualquier otra forma devuelve null. */
export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return /^[A-Za-z]{3}$/.test(text) ? text.toUpperCase() : null;
}

/**
 * Normaliza la confianza a un valor 0..1 redondeado a 3 decimales.
 * Acepta números y cadenas numéricas. Los valores mayores que 1 se interpretan
 * como porcentaje solo cuando son enteros (90 → 0.9); 1.5 no es un porcentaje
 * plausible y devuelve null.
 */
export function normalizeConfidence(value: unknown): number | null {
  let parsed: number;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  let normalized = parsed;
  if (parsed > 1) {
    if (parsed > 100 || !Number.isInteger(parsed)) {
      return null;
    }
    normalized = parsed / 100;
  }

  if (normalized > 1) {
    return null;
  }

  return Math.round(normalized * 1000) / 1000;
}

/**
 * Mapea una predicción cruda (formato Mindee u homólogo) al contrato interno.
 * No lanza: cualquier campo ausente o inválido se resuelve como null, 0 o array vacío.
 */
export function normalizeOcrExtraction(raw: Record<string, unknown>): OcrExtraction {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};

  return {
    providerName: toText(nestedFieldValue(source, 'supplier', 'name')),
    taxId: toText(nestedFieldValue(source, 'supplier', 'company_registration_number')),
    issueDate: normalizeDate(fieldValue(source, 'date')),
    currency: normalizeCurrency(fieldValue(source, 'currency')),
    totalMinor: parseDecimalToMinor(fieldValue(source, 'total_amount')),
    lineItems: normalizeLineItems(source.line_items),
    confidence: normalizeConfidence(fieldValue(source, 'confidence')),
    raw: source,
  };
}

function normalizeLineItems(value: unknown): OcrLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((item) => ({
    description: toText(fieldValue(item, 'description')) ?? '',
    quantity: toQuantity(fieldValue(item, 'quantity')),
    unitPriceMinor: parseDecimalToMinor(fieldValue(item, 'unit_price')) ?? '0',
    taxRateBps: toTaxRateBps(fieldValue(item, 'tax_rate')),
    totalMinor: parseDecimalToMinor(fieldValue(item, 'total_amount')) ?? '0',
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Desenvuelve los campos estilo Mindee (`{ value: ... }`) o devuelve el valor plano. */
function fieldValue(source: Record<string, unknown>, key: string): unknown {
  const value = source[key];
  if (isRecord(value) && 'value' in value) {
    return value.value;
  }
  return value;
}

function nestedFieldValue(
  source: Record<string, unknown>,
  parentKey: string,
  key: string,
): unknown {
  const parent = source[parentKey];
  return isRecord(parent) ? fieldValue(parent, key) : undefined;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  return null;
}

function toQuantity(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.replace(',', '.'))
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

/**
 * Convierte una tasa de impuesto a puntos básicos. Un valor ≤ 1 se interpreta
 * como fracción (0.21 → 2100 bps) y el resto como porcentaje (21 → 2100 bps).
 */
function toTaxRateBps(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.replace(',', '.'))
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed <= 1 ? Math.round(parsed * 10000) : Math.round(parsed * 100);
}
