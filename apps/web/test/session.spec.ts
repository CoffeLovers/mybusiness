import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_COOKIE_VERSION,
  readSessionCookieValue,
  sessionCookieOptions,
} from '../lib/session/cookies';
import {
  assertSecret,
  generateCsrfToken,
  generateId,
  openSession,
  sealSession,
  verifyCsrfToken,
} from '../lib/session/crypto';
import { SESSION_POLICY, evaluateSession, touchSession } from '../lib/session/policy';
import type { SessionRecord } from '../lib/session/types';
import { getServerEnv } from '../lib/server/env';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const HOUR_MS = 60 * 60 * 1000;
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('crypto — sealSession/openSession', () => {
  it('hace round-trip preservando el registro completo', () => {
    const session = makeSession();
    const token = sealSession(session, SECRET);

    expect(token.startsWith('v1.')).toBe(true);
    expect(token.split('.')).toHaveLength(4);
    expect(openSession(token, SECRET)).toEqual(session);
  });

  it('devuelve null si el token fue manipulado', () => {
    const token = sealSession(makeSession(), SECRET);
    const parts = token.split('.');
    const ciphertext = parts[3] ?? '';
    const tampered = [
      ...parts.slice(0, 3),
      ciphertext.slice(0, -1) + (ciphertext.endsWith('A') ? 'B' : 'A'),
    ].join('.');

    expect(openSession(tampered, SECRET)).toBeNull();
  });

  it('devuelve null con un secreto distinto', () => {
    const token = sealSession(makeSession(), SECRET);

    expect(openSession(token, OTHER_SECRET)).toBeNull();
  });

  it('devuelve null ante formatos inválidos sin lanzar', () => {
    const valid = sealSession(makeSession(), SECRET);
    const [prefix, iv, tag, ciphertext] = valid.split('.');
    const malformed = [
      '',
      'basura',
      'v2.aaa.bbb.ccc',
      `${prefix}.${iv}.${tag}`,
      `${prefix}.${iv}.${tag}.${ciphertext}.extra`,
      `${prefix}.${iv}.${'!'.repeat(10)}.${ciphertext}`,
      `${prefix}.${'A'.repeat(8)}.${tag}.${ciphertext}`,
      `${prefix}.${iv}.${tag}.`,
      `${prefix}.${iv}.${tag}.${ciphertext}==`,
    ];

    for (const token of malformed) {
      expect(openSession(token, SECRET)).toBeNull();
    }
  });

  it('lanza si el secreto es demasiado corto', () => {
    expect(() => sealSession(makeSession(), 'corto')).toThrow(
      'WEB_SESSION_SECRET debe tener al menos 32 caracteres',
    );
    expect(() => assertSecret('corto')).toThrow(/al menos 32 caracteres/);
    expect(() => assertSecret(SECRET)).not.toThrow();
  });

  it('genera identificadores únicos en base64url', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));

    expect(ids.size).toBe(20);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
});

describe('crypto — CSRF', () => {
  it('verifica un token recién generado', () => {
    const token = generateCsrfToken(SECRET, 'session-1');

    expect(token.split('.')).toHaveLength(2);
    expect(verifyCsrfToken(token, SECRET, 'session-1')).toBe(true);
  });

  it('rechaza el token de otra sesión', () => {
    const token = generateCsrfToken(SECRET, 'session-1');

    expect(verifyCsrfToken(token, SECRET, 'session-2')).toBe(false);
  });

  it('rechaza un token alterado, vacío o ausente', () => {
    const token = generateCsrfToken(SECRET, 'session-1');
    const [nonce, signature] = token.split('.');
    const flipped =
      signature?.endsWith('A') === true ? `${signature.slice(0, -1)}B` : `${signature ?? ''}A`;

    expect(verifyCsrfToken(`${nonce}.${flipped}`, SECRET, 'session-1')).toBe(false);
    expect(verifyCsrfToken(`${nonce}.`, SECRET, 'session-1')).toBe(false);
    expect(verifyCsrfToken('sin-punto', SECRET, 'session-1')).toBe(false);
    expect(verifyCsrfToken(undefined, SECRET, 'session-1')).toBe(false);
    expect(verifyCsrfToken('', SECRET, 'session-1')).toBe(false);
    expect(verifyCsrfToken(token, OTHER_SECRET, 'session-1')).toBe(false);
  });

  it('lanza al generar con secreto corto', () => {
    expect(() => generateCsrfToken('corto', 'session-1')).toThrow(/al menos 32 caracteres/);
  });
});

describe('policy — evaluateSession', () => {
  it('considera válida una sesión recién creada', () => {
    const state = evaluateSession(makeSession(), NOW);

    expect(state).toEqual({ status: 'valid', session: makeSession() });
  });

  it('marca idle al alcanzar exactamente 30 minutos sin actividad', () => {
    expect(evaluateSession(makeSession({ lastSeenAt: NOW - 30 * 60 * 1000 + 1 }), NOW)).toEqual({
      status: 'valid',
      session: makeSession({ lastSeenAt: NOW - 30 * 60 * 1000 + 1 }),
    });

    expect(evaluateSession(makeSession({ lastSeenAt: NOW - 30 * 60 * 1000 }), NOW)).toEqual({
      status: 'expired',
      reason: 'idle',
    });
  });

  it('marca absolute a las 12 horas aunque haya actividad reciente', () => {
    const state = evaluateSession(
      makeSession({ issuedAt: NOW - SESSION_POLICY.absoluteTimeoutMs, lastSeenAt: NOW - 1000 }),
      NOW,
    );

    expect(state).toEqual({ status: 'expired', reason: 'absolute' });
  });

  it('invalida sesiones con issuedAt en el futuro más de un minuto', () => {
    expect(evaluateSession(makeSession({ issuedAt: NOW + 61_000, lastSeenAt: NOW }), NOW)).toEqual({
      status: 'invalid',
    });
    expect(evaluateSession(makeSession({ issuedAt: NOW + 30_000, lastSeenAt: NOW }), NOW)).toEqual({
      status: 'valid',
      session: makeSession({ issuedAt: NOW + 30_000, lastSeenAt: NOW }),
    });
  });

  it('invalida registros con campos obligatorios vacíos o fechas no finitas', () => {
    const blankUser = makeSession({
      user: { ...makeSession().user, id: '   ' },
    });

    expect(evaluateSession(blankUser, NOW)).toEqual({ status: 'invalid' });
    expect(evaluateSession(makeSession({ accessToken: '' }), NOW)).toEqual({ status: 'invalid' });
    expect(evaluateSession(makeSession({ sessionId: '' }), NOW)).toEqual({ status: 'invalid' });
    expect(evaluateSession(makeSession({ issuedAt: Number.NaN }), NOW)).toEqual({
      status: 'invalid',
    });
  });

  it('usa Date.now por defecto', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    try {
      expect(evaluateSession(makeSession())).toEqual({
        status: 'valid',
        session: makeSession(),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('policy — touchSession', () => {
  it('actualiza lastSeenAt sin mutar el original', () => {
    const session = makeSession();
    const touched = touchSession(session, NOW + 5_000);

    expect(touched.lastSeenAt).toBe(NOW + 5_000);
    expect(session.lastSeenAt).toBe(NOW);
    expect(touched).not.toBe(session);
    expect(touched.sessionId).toBe(session.sessionId);
  });
});

describe('cookies', () => {
  it('expone los nombres y la versión canónicos', () => {
    expect(SESSION_COOKIE).toBe('mb_session');
    expect(CSRF_COOKIE).toBe('mb_csrf');
    expect(SESSION_COOKIE_VERSION).toBe('v1');
  });

  it('deriva las opciones de cookie del entorno', () => {
    expect(sessionCookieOptions(true)).toEqual({ secure: true, maxAgeSeconds: 12 * 60 * 60 });
    expect(sessionCookieOptions(false)).toEqual({ secure: false, maxAgeSeconds: 12 * 60 * 60 });
  });

  it('normaliza el valor de la cookie', () => {
    expect(readSessionCookieValue('  v1.abc  ')).toBe('v1.abc');
    expect(readSessionCookieValue('')).toBeUndefined();
    expect(readSessionCookieValue('   ')).toBeUndefined();
    expect(readSessionCookieValue(undefined)).toBeUndefined();
  });
});

describe('getServerEnv', () => {
  it('lanza si el secreto falta o es corto', () => {
    vi.stubEnv('WEB_SESSION_SECRET', '');
    expect(() => getServerEnv()).toThrow(/WEB_SESSION_SECRET/);

    vi.stubEnv('WEB_SESSION_SECRET', 'corto');
    expect(() => getServerEnv()).toThrow(/al menos 32 caracteres/);
  });

  it('devuelve los valores por defecto con un secreto válido', () => {
    vi.stubEnv('WEB_SESSION_SECRET', SECRET);
    vi.stubEnv('WEB_GATEWAY_URL', '');
    vi.stubEnv('WEB_ALLOWED_ORIGINS', '');
    vi.stubEnv('WEB_SECURE_COOKIES', '');
    vi.stubEnv('NODE_ENV', 'test');

    expect(getServerEnv()).toEqual({
      sessionSecret: SECRET,
      gatewayUrl: 'http://127.0.0.1:3000',
      allowedOrigins: ['http://localhost:3001'],
      secureCookies: false,
    });
  });

  it('respeta las variables y normaliza la configuración', () => {
    vi.stubEnv('WEB_SESSION_SECRET', SECRET);
    vi.stubEnv('WEB_GATEWAY_URL', 'http://gateway:3000///');
    vi.stubEnv('WEB_ALLOWED_ORIGINS', ' http://a.test ,, http://b.test ');
    vi.stubEnv('WEB_SECURE_COOKIES', 'true');
    vi.stubEnv('NODE_ENV', 'test');

    expect(getServerEnv()).toEqual({
      sessionSecret: SECRET,
      gatewayUrl: 'http://gateway:3000',
      allowedOrigins: ['http://a.test', 'http://b.test'],
      secureCookies: true,
    });
  });

  it('activa cookies seguras en producción', () => {
    vi.stubEnv('WEB_SESSION_SECRET', SECRET);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_SECURE_COOKIES', '');

    expect(getServerEnv().secureCookies).toBe(true);
  });
});

describe('SESSION_POLICY', () => {
  it('define las ventanas de 30 minutos y 12 horas', () => {
    expect(SESSION_POLICY).toEqual({
      idleTimeoutMs: 30 * 60 * 1000,
      absoluteTimeoutMs: 12 * HOUR_MS,
    });
  });
});
