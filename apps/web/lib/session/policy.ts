/**
 * Política temporal de sesión: caducidad por inactividad y caducidad absoluta.
 *
 * Las funciones son puras: reciben el reloj como parámetro para poder probarlas
 * sin depender del tiempo real.
 */

import type { SessionPolicy, SessionRecord, SessionState } from './types';

/** Margen de tolerancia para desfases de reloj entre cliente y servidor. */
const CLOCK_SKEW_MS = 60_000;

export const SESSION_POLICY: SessionPolicy = {
  idleTimeoutMs: 30 * 60 * 1000,
  absoluteTimeoutMs: 12 * 60 * 60 * 1000,
};

/** Indica si los campos mínimos del registro están presentes y no vacíos. */
function hasRequiredFields(session: SessionRecord): boolean {
  return (
    session.sessionId.trim().length > 0 &&
    session.user.id.trim().length > 0 &&
    session.user.tenantId.trim().length > 0 &&
    session.accessToken.trim().length > 0 &&
    session.refreshToken.trim().length > 0
  );
}

/**
 * Evalúa el estado de una sesión respecto de la política vigente.
 *
 * El orden importa: la caducidad absoluta prevalece sobre la de inactividad.
 */
export function evaluateSession(session: SessionRecord, now = Date.now()): SessionState {
  if (!Number.isFinite(session.issuedAt) || !Number.isFinite(session.lastSeenAt)) {
    return { status: 'invalid' };
  }

  if (session.issuedAt > now + CLOCK_SKEW_MS) {
    return { status: 'invalid' };
  }

  if (!hasRequiredFields(session)) {
    return { status: 'invalid' };
  }

  if (now - session.issuedAt >= SESSION_POLICY.absoluteTimeoutMs) {
    return { status: 'expired', reason: 'absolute' };
  }

  if (now - session.lastSeenAt >= SESSION_POLICY.idleTimeoutMs) {
    return { status: 'expired', reason: 'idle' };
  }

  return { status: 'valid', session };
}

/** Devuelve una copia de la sesión con `lastSeenAt` actualizado; no muta el original. */
export function touchSession(session: SessionRecord, now = Date.now()): SessionRecord {
  return { ...session, lastSeenAt: now };
}
