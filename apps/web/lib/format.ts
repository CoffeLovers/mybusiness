/**
 * Formateo de importes monetarios almacenados en unidades menores
 * (céntimos). El dominio nunca trabaja con floats: los importes viajan como
 * enteros y sólo se convierten a formato localizado para mostrarlos.
 */

const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_LOCALE = 'es-ES';

/** Espacio no separable que separa el signo del importe. */
const SIGN_GAP = '\u00A0';

/** Decimales asumidos cuando `Intl` no puede resolver la divisa (p. ej. código inválido). */
const DEFAULT_FRACTION_DIGITS = 2;

/**
 * Caché de formateadores por `locale|currency`. Crear un `Intl.NumberFormat` es
 * caro y las listas de movimientos reutilizan la misma divisa miles de veces,
 * así que se memoiza la instancia. El `Map` es de módulo: vive mientras viva el
 * proceso, igual que las instancias cacheadas.
 */
const formatters = new Map<string, Intl.NumberFormat>();

/** Ejecuta `operation` y devuelve `fallback` si lanza. */
function runCatching<T>(operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}

/**
 * Devuelve el formateador memoizado para la combinación `locale`/`currency`.
 *
 * `useGrouping: true` explícito: el CLDR de `es` marca `minimumGroupingDigits=2`
 * y sin esta opción 1234,56 se emitiría sin separador de miles.
 */
function formatterFor(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const cached = formatters.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: true,
  });
  formatters.set(key, formatter);

  return formatter;
}

/**
 * Número de decimales que `Intl` usa para la divisa: 0 para JPY/CLP/COP,
 * 2 para EUR/USD y 3 para KWD. Sin esto, formatear unidades menores con
 * `/100` produciría "12.345,00 ¥" en vez de "12.345 ¥".
 */
function fractionDigitsFor(currency: string, locale: string): number {
  return (
    runCatching(
      () => formatterFor(currency, locale).resolvedOptions().maximumFractionDigits,
      DEFAULT_FRACTION_DIGITS,
    ) ?? DEFAULT_FRACTION_DIGITS
  );
}

/**
 * Formatea un importe en unidades menores como moneda localizada.
 *
 * @example formatMinorUnits(123456) // "1.234,56 €"
 * @throws RangeError si `amountMinor` no es un entero finito.
 */
export function formatMinorUnits(
  amountMinor: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor)) {
    throw new RangeError(`amountMinor debe ser un entero finito; recibido: ${String(amountMinor)}`);
  }

  const digits = fractionDigitsFor(currency, locale);
  const divisor = 10 ** digits;

  return formatterFor(currency, locale).format(amountMinor / divisor);
}

/**
 * Igual que `formatMinorUnits` pero con signo explícito para los importes
 * distintos de cero (`+` para ingresos, `-` para gastos). El valor absoluto se
 * formatea sin signo para no duplicar el que añade `Intl`.
 *
 * @example formatSignedMinorUnits(12345) // "+ 123,45 €"
 */
export function formatSignedMinorUnits(
  amountMinor: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const magnitude = formatMinorUnits(Math.abs(amountMinor), currency, locale);

  if (amountMinor > 0) {
    return `+${SIGN_GAP}${magnitude}`;
  }

  if (amountMinor < 0) {
    return `-${SIGN_GAP}${magnitude}`;
  }

  return magnitude;
}

/**
 * Formatea un importe en unidades menores (céntimos) serializado como string.
 *
 * Utiliza BigInt para separar la parte entera y los decimales, y formatea
 * mediante Intl.NumberFormat pasando una cadena decimal de precisión arbitraria,
 * garantizando que nunca se convierta el importe a number ni se pierda precisión.
 *
 * @param amountMinor - Cadena entera con o sin signo negativo (ej. "123456", "-123456", "0").
 * @param currency - Código ISO 4217 de la divisa (por defecto 'EUR').
 * @param locale - Identificador de configuración regional BCP 47 (por defecto 'es-ES').
 * @returns Cadena con el importe formateado en la moneda y locale especificados.
 * @throws RangeError si amountMinor no es una cadena válida de dígitos enteros.
 */
export function formatMinorUnitsString(
  amountMinor: string,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof amountMinor !== 'string' || !/^-?\d+$/.test(amountMinor.trim())) {
    throw new RangeError(`amountMinor debe ser un string entero; recibido: ${String(amountMinor)}`);
  }

  const trimmed = amountMinor.trim();
  const value = BigInt(trimmed);
  const isNegative = value < 0n;
  const absVal = isNegative ? -value : value;

  // La divisa decide los decimales (JPY/CLP = 0, EUR/USD = 2, KWD = 3).
  const digits = fractionDigitsFor(currency, locale);
  const divisor = 10n ** BigInt(digits);
  const whole = absVal / divisor;
  const fraction = absVal % divisor;
  const fractionStr = digits > 0 ? fraction.toString().padStart(digits, '0') : '';
  const decimalString = `${isNegative ? '-' : ''}${whole.toString()}${
    digits > 0 ? `.${fractionStr}` : ''
  }`;

  // `Intl.NumberFormat#format` acepta cadenas decimales desde la especificación
  // Intl v3 (Node 20 / V8 moderno), pero los tipos de TS todavía lo declaran
  // como `number`; el cast documenta esa brecha sin convertir realmente el valor.
  return formatterFor(currency, locale).format(decimalString as unknown as number);
}

/**
 * Variante con signo explícito de `formatMinorUnitsString`.
 */
export function formatSignedMinorUnitsString(
  amountMinor: string,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof amountMinor !== 'string' || !/^-?\d+$/.test(amountMinor.trim())) {
    throw new RangeError(`amountMinor debe ser un string entero; recibido: ${String(amountMinor)}`);
  }

  const trimmed = amountMinor.trim();
  const value = BigInt(trimmed);
  const absVal = value < 0n ? -value : value;
  const magnitude = formatMinorUnitsString(absVal.toString(), currency, locale);

  if (value > 0n) {
    return `+${SIGN_GAP}${magnitude}`;
  }

  if (value < 0n) {
    return `-${SIGN_GAP}${magnitude}`;
  }

  return magnitude;
}
