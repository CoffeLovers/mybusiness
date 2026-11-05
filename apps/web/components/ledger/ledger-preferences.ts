'use client';

/**
 * Preferencias de presentación del libro mayor.
 *
 * La densidad se persiste por usuario en `localStorage`. El valor inicial es
 * siempre `comfortable` para que el HTML del servidor coincida con el primer
 * render del cliente; la lectura real ocurre en un `useEffect` y así se evita
 * el desajuste de hidratación.
 */

import { useCallback, useEffect, useState } from 'react';

export type LedgerDensity = 'comfortable' | 'compact';

export const LEDGER_DENSITY_STORAGE_KEY = 'mybusiness.ledger.density';

/** Alto de fila en píxeles según la densidad (DESIGN-RULES §6). */
export const LEDGER_ROW_HEIGHT: Record<LedgerDensity, number> = {
  comfortable: 48,
  compact: 36,
};

function isDensity(value: unknown): value is LedgerDensity {
  return value === 'comfortable' || value === 'compact';
}

/** Lee la densidad persistida; cualquier fallo cae al valor por defecto. */
export function readStoredDensity(storage?: Storage): LedgerDensity {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    const stored = target?.getItem(LEDGER_DENSITY_STORAGE_KEY);

    return isDensity(stored) ? stored : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/** Persiste la densidad; el almacenamiento puede no estar disponible. */
export function writeStoredDensity(density: LedgerDensity, storage?: Storage): void {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);

    target?.setItem(LEDGER_DENSITY_STORAGE_KEY, density);
  } catch {
    // Modo privado o cuota agotada: la preferencia es sólo una comodidad.
  }
}

export interface UseLedgerDensityResult {
  density: LedgerDensity;
  setDensity: (density: LedgerDensity) => void;
}

export function useLedgerDensity(): UseLedgerDensityResult {
  const [density, setDensityState] = useState<LedgerDensity>('comfortable');

  useEffect(() => {
    const stored = readStoredDensity();

    if (stored !== 'comfortable') {
      setDensityState(stored);
    }
  }, []);

  const setDensity = useCallback((next: LedgerDensity) => {
    setDensityState(next);
    writeStoredDensity(next);
  }, []);

  return { density, setDensity };
}
