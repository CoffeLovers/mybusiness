'use client';

import { useSyncExternalStore } from 'react';

/** Query que expresa la preferencia del sistema por movimiento reducido. */
export const PREFERS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(PREFERS_REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener('change', onStoreChange);

  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

/**
 * Snapshot del cliente: se lee `matchMedia` de forma síncrona, así el primer
 * render ya refleja la preferencia real del usuario.
 *
 * No puede devolver `false` fijo: ECharts arrancaría con `animation: true` y
 * animaría el gráfico una vez para quien pidió movimiento reducido (un
 * `useEffect` llega tarde a corregirlo).
 */
function getSnapshot(): boolean {
  return window.matchMedia(PREFERS_REDUCED_MOTION_QUERY).matches;
}

/**
 * Snapshot del servidor: durante el SSR no existe `window`, así que se asume
 * movimiento reducido desactivado. Solo aplica al HTML inicial; la hidratación
 * sustituye el valor con el de `getSnapshot`.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Devuelve `true` cuando el sistema operativo pide movimiento reducido.
 * Se sincroniza con los cambios de la media query en tiempo real.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
