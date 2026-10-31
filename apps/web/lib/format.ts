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
