import { describe, expect, it } from 'vitest';

import {
  REAUTH_WINDOW_MS,
  markReauthenticated,
  requiresReauthentication,
} from '../lib/session/reauth';
import type { SessionRecord } from '../lib/session/types';

const NOW = new Date('2026-10-31T12:00:00.000Z').getTime();

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    version: 1,
    sessionId: 'session-1',
    deviceId: 'device-1',
    user: {
      id: 'user-1',
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      role: 'owner',
      tenantId: 'tenant-1',
    },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    issuedAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  };
}

describe('reauth — ventana de 5 minutos', () => {
  it('expone la ventana canónica', () => {
    expect(REAUTH_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it('no exige reautenticación dentro de la ventana', () => {
    expect(requiresReauthentication(makeSession(), NOW)).toBe(false);
    expect(
      requiresReauthentication(makeSession({ lastSeenAt: NOW - REAUTH_WINDOW_MS + 1 }), NOW),
    ).toBe(false);
  });

  it('exige reautenticación fuera de la ventana', () => {
    expect(
      requiresReauthentication(makeSession({ lastSeenAt: NOW - REAUTH_WINDOW_MS - 1 }), NOW),
    ).toBe(true);
  });
});

describe('reauth — markReauthenticated', () => {
  it('devuelve una copia con lastSeenAt actualizado sin mutar el original', () => {
    const session = makeSession({ lastSeenAt: NOW - 10 * 60 * 1000 });
    const marked = markReauthenticated(session, NOW);

    expect(marked).not.toBe(session);
    expect(marked.lastSeenAt).toBe(NOW);
    expect(session.lastSeenAt).toBe(NOW - 10 * 60 * 1000);
    expect(requiresReauthentication(marked, NOW)).toBe(false);
  });
});
