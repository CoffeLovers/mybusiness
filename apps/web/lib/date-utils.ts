/**
 * Utilidades para fechas de períodos y visualización de buckets.
 */

export type PeriodPreset = '30d' | '90d' | 'ytd';

/**
 * Devuelve el rango de fechas { from, to } en formato YYYY-MM-DD para un preset.
 * Usa UTC para garantizar determinismo independientemente de la zona horaria del cliente.
 */
export function getPresetDates(
  preset: PeriodPreset,
  referenceDate: Date = new Date(),
): { from: string; to: string } {
  const toStr = referenceDate.toISOString().slice(0, 10);
  const refTime = referenceDate.getTime();

  if (preset === '30d') {
    // 30 días inclusive (hoy y 29 días atrás)
    const fromDate = new Date(refTime - 29 * 86400000);
    return { from: fromDate.toISOString().slice(0, 10), to: toStr };
  }

  if (preset === '90d') {
    // 90 días inclusive (hoy y 89 días atrás)
    const fromDate = new Date(refTime - 89 * 86400000);
    return { from: fromDate.toISOString().slice(0, 10), to: toStr };
  }

  // ytd: desde 1 de enero del año actual
  const year = referenceDate.getUTCFullYear();
  return { from: `${year}-01-01`, to: toStr };
}

/**
 * Determina cuál preset coincide con el rango actual (o null si es personalizado).
 */
export function detectPreset(
  from: string,
  to: string,
  referenceDate: Date = new Date(),
): PeriodPreset | 'custom' {
  for (const preset of ['30d', '90d', 'ytd'] as const) {
    const dates = getPresetDates(preset, referenceDate);
    if (dates.from === from && dates.to === to) {
      return preset;
    }
  }
  return 'custom';
}

/**
 * Formatea una fecha de bucket (YYYY-MM-DD o YYYY-MM-01) para mostrarla de forma compacta.
 */
export function formatBucketLabel(
  bucketStart: string,
  isMonthly: boolean = false,
  locale: string = 'es-ES',
): string {
  try {
    const parts = bucketStart.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (isNaN(y) || isNaN(m) || isNaN(d)) {
      return bucketStart;
    }
    const date = new Date(Date.UTC(y, m - 1, d));

    if (isMonthly) {
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
    }
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return bucketStart;
  }
}
