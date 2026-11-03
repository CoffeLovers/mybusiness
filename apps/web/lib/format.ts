/**
 * Formateo de importes monetarios almacenados en unidades menores
 * (céntimos). El dominio nunca trabaja con floats: los importes viajan como
 * enteros y sólo se convierten a formato localizado para mostrarlos.
 */

const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_LOCALE = 'es-ES';

/** Espacio no separable que separa el signo del importe. */
const SIGN_GAP = '\u00A0';

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

  // `useGrouping: true` explícito: el CLDR de `es` marca `minimumGroupingDigits=2`
  // y sin esta opción 1234,56 se emitiría sin separador de miles.
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: true,
  });

  return formatter.format(amountMinor / 100);
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

  const whole = absVal / 100n;
  const fraction = absVal % 100n;
  const fractionStr = fraction.toString().padStart(2, '0');
  const decimalString = `${isNegative ? '-' : ''}${whole.toString()}.${fractionStr}`;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: true,
  });

  return formatter.format(decimalString as unknown as number);
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
