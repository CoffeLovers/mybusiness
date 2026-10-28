import type { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import { parseDurationToMs } from '@mybusiness/common';

export const ACCESS_TOKEN_COOKIE = 'mybusiness_access_token';
export const REFRESH_TOKEN_COOKIE = 'mybusiness_refresh_token';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

function useSecureCookies(config: ConfigService): boolean {
  if (config.get<string>('NODE_ENV') === 'production') {
    return true;
  }

  return config.get<string>('AUTH_COOKIE_SECURE')?.toLowerCase() === 'true';
}

function baseOptions(config: ConfigService, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: useSecureCookies(config),
    sameSite: 'strict',
    path,
  };
}

export function getAccessTokenTtlMs(config: ConfigService): number {
  return parseDurationToMs(config.getOrThrow<string>('JWT_EXPIRES_IN'));
}

export function getRefreshTokenTtlMs(config: ConfigService): number {
  return parseDurationToMs(config.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_IN'));
}

export function accessCookieOptions(config: ConfigService): CookieOptions {
  return {
    ...baseOptions(config, '/'),
    maxAge: getAccessTokenTtlMs(config),
  };
}

export function refreshCookieOptions(config: ConfigService): CookieOptions {
  return {
    ...baseOptions(config, REFRESH_TOKEN_COOKIE_PATH),
    maxAge: getRefreshTokenTtlMs(config),
  };
}

export function clearCookieOptions(config: ConfigService, path: string): CookieOptions {
  return baseOptions(config, path);
}
