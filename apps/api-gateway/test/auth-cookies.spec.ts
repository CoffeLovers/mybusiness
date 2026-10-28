import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
  clearCookieOptions,
  getAccessTokenTtlMs,
  getRefreshTokenTtlMs,
} from '../src/auth/auth-cookies';

describe('auth-cookies (Unit)', () => {
  const config = {
    get: (key: string) => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      if (key === 'REFRESH_TOKEN_EXPIRES_IN') return '7d';
      return undefined;
    },
    getOrThrow: (key: string) => {
      if (key === 'JWT_EXPIRES_IN') return '15m';
      if (key === 'REFRESH_TOKEN_EXPIRES_IN') return '7d';
      throw new Error(`missing ${key}`);
    },
  } as unknown as ConfigService;

  it('constantes de cookies tienen nombres esperados', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('mybusiness_access_token');
    expect(REFRESH_TOKEN_COOKIE).toBe('mybusiness_refresh_token');
  });

  it('accessCookieOptions es httpOnly, sameSite strict, path /', () => {
    const opts = accessCookieOptions(config);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/');
    expect(typeof opts.maxAge).toBe('number');
    expect(opts.maxAge).toBeGreaterThan(0);
  });

  it('refreshCookieOptions usa path de refresh', () => {
    const opts = refreshCookieOptions(config);
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe('/api/v1/auth');
    expect(opts.maxAge).toBeGreaterThan(0);
  });

  it('clearCookieOptions no incluye maxAge', () => {
    const opts = clearCookieOptions(config, '/');
    expect(opts.maxAge).toBeUndefined();
  });

  it('getAccessTokenTtlMs y getRefreshTokenTtlMs devuelven ms positivos', () => {
    expect(getAccessTokenTtlMs(config)).toBeGreaterThan(0);
    expect(getRefreshTokenTtlMs(config)).toBeGreaterThan(0);
  });
});
