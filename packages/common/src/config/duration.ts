const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;
const UNIT_TO_MS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

/**
 * Convierte una duración de configuración (`15m`, `7d`, `3600s`, etc.) a milisegundos.
 * Falla de forma temprana ante valores inválidos o no positivos.
 */
export function parseDurationToMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error(
      `Duración inválida: "${value}". Usa un entero seguido de ms, s, m, h o d (ej. 15m).`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_TO_MS;
  const milliseconds = amount * UNIT_TO_MS[unit];

  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`La duración debe ser un entero positivo: "${value}".`);
  }

  return milliseconds;
}
