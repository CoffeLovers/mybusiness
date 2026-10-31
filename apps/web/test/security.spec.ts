import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { generateCsrfToken } from '../lib/session/crypto';
import {
  FORBIDDEN_CSRF,
  FORBIDDEN_ORIGIN,
  hasValidCsrf,
  isAllowedOrigin,
} from '../lib/server/security';

const SECRET = 'a'.repeat(32);
const SESSION_ID = 'session-1';
const OTHER_SESSION_ID = 'session-2';
const API_URL = 'http://localhost:3001/api/session/login';
const ALLOWED = ['http://localhost:3001'];

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(API_URL), { method: 'POST', headers });
}

function makeCsrfRequest(token: string | undefined, cookie: string | undefined): NextRequest {
  const headers: Record<string, string> = {};

  if (token !== undefined) {
    headers['x-csrf-token'] = token;
  }

  const request = makeRequest(headers);

  if (cookie !== undefined) {
    request.cookies.set('mb_csrf', cookie);
  }

  return request;
}

describe('isAllowedOrigin', () => {
  it('acepta un origen permitido', () => {
    expect(isAllowedOrigin(makeRequest({ origin: 'http://localhost:3001' }), ALLOWED)).toBe(true);
  });

  it('rechaza un origen no permitido', () => {
    expect(isAllowedOrigin(makeRequest({ origin: 'http://evil.example' }), ALLOWED)).toBe(false);
  });

  it('usa el referer cuando falta el origin', () => {
    expect(isAllowedOrigin(makeRequest({ referer: 'http://localhost:3001/login' }), ALLOWED)).toBe(
      true,
    );
  });

  it('rechaza cuando no hay origin ni referer', () => {
    expect(isAllowedOrigin(makeRequest(), ALLOWED)).toBe(false);
  });

  it('rechaza un origen con puerto distinto', () => {
    expect(isAllowedOrigin(makeRequest({ origin: 'http://localhost:9999' }), ALLOWED)).toBe(false);
  });

  it('expone códigos estables', () => {
    expect(FORBIDDEN_ORIGIN).toBe('origin_not_allowed');
    expect(FORBIDDEN_CSRF).toBe('csrf_invalid');
  });
});

describe('hasValidCsrf', () => {
  it('acepta token válido en header y cookie', () => {
    const token = generateCsrfToken(SECRET, SESSION_ID);
    expect(hasValidCsrf(makeCsrfRequest(token, token), SECRET, SESSION_ID)).toBe(true);
  });

  it('rechaza si sólo hay header', () => {
    const token = generateCsrfToken(SECRET, SESSION_ID);
    expect(hasValidCsrf(makeCsrfRequest(token, undefined), SECRET, SESSION_ID)).toBe(false);
  });

  it('rechaza si header y cookie difieren', () => {
    const token = generateCsrfToken(SECRET, SESSION_ID);
    const other = generateCsrfToken(SECRET, SESSION_ID);
    expect(hasValidCsrf(makeCsrfRequest(token, other), SECRET, SESSION_ID)).toBe(false);
  });

  it('rechaza un token de otra sesión', () => {
    const token = generateCsrfToken(SECRET, OTHER_SESSION_ID);
    expect(hasValidCsrf(makeCsrfRequest(token, token), SECRET, SESSION_ID)).toBe(false);
  });
});
