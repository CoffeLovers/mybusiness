import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ACCESS_TOKEN_COOKIE } from '../src/auth/auth-cookies';

describe('JwtAuthGuard (Unit)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let jwtService: JwtService;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;
    jwtService = { verifyAsync: vi.fn() } as unknown as JwtService;
    guard = new JwtAuthGuard(jwtService, reflector);
  });

  function makeContext(overrides: any = {}) {
    const req: any = {
      headers: overrides.headers || {},
      cookies: overrides.cookies || {},
      user: undefined,
    };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
      _req: req,
    } as any;
  }

  it('permite rutas públicas sin token', async () => {
    (reflector.getAllAndOverride as any).mockReturnValue(true);
    const ctx = makeContext();
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('lanza Unauthorized si no hay token', async () => {
    (reflector.getAllAndOverride as any).mockReturnValue(false);
    const ctx = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lanza Unauthorized si el token es inválido', async () => {
    (reflector.getAllAndOverride as any).mockReturnValue(false);
    (jwtService.verifyAsync as any).mockRejectedValue(new Error('bad'));
    const ctx = makeContext({ headers: { authorization: 'Bearer bad-token' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('acepta token Bearer válido y setea request.user', async () => {
    (reflector.getAllAndOverride as any).mockReturnValue(false);
    (jwtService.verifyAsync as any).mockResolvedValue({
      sub: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: 'admin',
    });
    const ctx = makeContext({ headers: { authorization: 'Bearer good-token' } });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx._req.user).toEqual({
      userId: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: 'admin',
    });
  });

  it('acepta token desde cookie si no hay Bearer', async () => {
    (reflector.getAllAndOverride as any).mockReturnValue(false);
    (jwtService.verifyAsync as any).mockResolvedValue({
      sub: 'u2',
      tenantId: 't2',
      email: 'c@d.com',
      role: 'user',
    });
    const ctx = makeContext({ cookies: { [ACCESS_TOKEN_COOKIE]: 'cookie-token' } });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx._req.user.userId).toBe('u2');
  });
});
