/**
 * Reautenticación para operaciones sensibles del BFF.
 *
 * La verificación real (password/TOTP) se delega al gateway cuando exista el
 * endpoint correspondiente; por ahora el BFF exige una sesión con actividad
 * reciente (< 5 min) como sustituto conservador.
 */

import type { SessionRecord } from './types';

/** Ventana durante la cual una sesión se considera reciente para operaciones sensibles. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export function requiresReauthentication(session: SessionRecord, now = Date.now()): boolean {
  return now - session.lastSeenAt > REAUTH_WINDOW_MS;
}

/**
 * Devuelve una copia de la sesión con `lastSeenAt: now`, marcándola como recién
 * reautenticada. No muta el registro original.
 *
 * La reautenticación real (password/TOTP) se delega al gateway cuando exista el
 * endpoint; mientras tanto el BFF sólo exige actividad < 5 min.
 */
export function markReauthenticated(session: SessionRecord, now = Date.now()): SessionRecord {
  return { ...session, lastSeenAt: now };
}
