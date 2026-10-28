import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, of, defer } from 'rxjs';
import {
  extractRpcContext,
  stripRpcContext,
  extractContext,
  stripContext,
  RpcTenantGuard,
  RpcTenantContextInterceptor,
  getTenantContext,
  IS_PUBLIC_KEY,
} from '@mybusiness/common';
import { UserRole } from '@mybusiness/contracts';

function rpcContext(data: unknown): any {
  return {
    getType: () => 'rpc',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToRpc: () => ({ getData: () => data }),
    switchToHttp: () => {
      throw new Error('not http');
    },
  };
}

function httpContext(request: Record<string, any>): any {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
    switchToRpc: () => ({ getData: () => request }),
  };
}

function reflector(isPublic?: boolean) {
  return {
    getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined)),
  } as any;
}

describe('extractRpcContext — casos borde', () => {
  it('normaliza tenantId numérico a string', () => {
    expect(extractRpcContext({ tenantId: 123, userId: 456 })).toEqual({
      tenantId: '123',
      userId: '456',
      role: undefined,
    });
  });

  it('tolera payloads primitivos, arrays y user nulo', () => {
    expect(extractRpcContext('texto')).toEqual({ tenantId: '', userId: '', role: undefined });
    expect(extractRpcContext([1, 2, 3])).toEqual({ tenantId: '', userId: '', role: undefined });
    expect(extractRpcContext({ user: null, tenantId: 't-1' })).toEqual({
      tenantId: 't-1',
      userId: '',
      role: undefined,
    });
    expect(extractRpcContext(undefined)).toEqual({ tenantId: '', userId: '', role: undefined });
  });

  it('prioriza userId sobre el alias id', () => {
    expect(extractRpcContext({ userId: 'real', id: 'alias', tenantId: 't-1' }).userId).toBe('real');
  });

  it('mantiene los alias deprecated apuntando a las nuevas funciones', () => {
    expect(extractContext).toBe(extractRpcContext);
    expect(stripContext).toBe(stripRpcContext);
  });
});

describe('stripRpcContext — casos borde', () => {
  it('no muta el payload original', () => {
    const original = { tenantId: 't-1', userId: 'u-1', role: UserRole.VIEWER, amountMinor: '1' };
    const stripped = stripRpcContext(original);
    expect(stripped).toEqual({ amountMinor: '1' });
    expect(original).toHaveProperty('tenantId', 't-1');
  });

  it('devuelve primitivos y null sin cambios', () => {
    expect(stripRpcContext(null as any)).toBeNull();
    expect(stripRpcContext('x' as any)).toBe('x');
    expect(stripRpcContext(42 as any)).toBe(42);
  });

  it('solo elimina las claves de contexto presentes', () => {
    expect(stripRpcContext({ tenantId: 't-1', foo: 'bar' })).toEqual({ foo: 'bar' });
    expect(stripRpcContext({ foo: 'bar' } as any)).toEqual({ foo: 'bar' });
  });
});

describe('RpcTenantGuard', () => {
  it('permite handlers marcados como públicos sin tenant', () => {
    const guard = new RpcTenantGuard(reflector(true));
    expect(guard.canActivate(rpcContext({}))).toBe(true);
  });

  it('permite cuando el payload RPC trae tenantId', () => {
    const guard = new RpcTenantGuard(reflector(false));
    expect(guard.canActivate(rpcContext({ tenantId: 't-1', userId: 'u-1' }))).toBe(true);
  });

  it('permite payloads anidados bajo user', () => {
    const guard = new RpcTenantGuard(reflector(false));
    expect(guard.canActivate(rpcContext({ user: { tenantId: 't-1' } }))).toBe(true);
  });

  it('lanza Unauthorized si falta el tenant o el payload está vacío', () => {
    const guard = new RpcTenantGuard(reflector(false));
    expect(() => guard.canActivate(rpcContext({ userId: 'u-1' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(rpcContext(null))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(rpcContext({ tenantId: '' }))).toThrow(UnauthorizedException);
  });
});

describe('RpcTenantContextInterceptor', () => {
  it('expone el contexto durante el handler RPC', async () => {
    const interceptor = new RpcTenantContextInterceptor();
    const observed = await firstValueFrom(
      interceptor.intercept(rpcContext({ tenantId: 't-1', userId: 'u-1', role: UserRole.VIEWER }), {
        handle: () => of(getTenantContext()),
      }),
    );
    expect(observed).toEqual({ tenantId: 't-1', userId: 'u-1', role: UserRole.VIEWER });
  });

  it('mantiene el contexto en handlers diferidos (suscripción de Nest)', async () => {
    const interceptor = new RpcTenantContextInterceptor();
    const observed = await firstValueFrom(
      interceptor.intercept(rpcContext({ tenantId: 't-2', userId: 'u-2', role: UserRole.VIEWER }), {
        handle: () => defer(() => of(getTenantContext())),
      }),
    );
    expect(observed).toEqual({ tenantId: 't-2', userId: 'u-2', role: UserRole.VIEWER });
  });

  it('no establece contexto si el payload no trae tenantId', async () => {
    const interceptor = new RpcTenantContextInterceptor();
    const observed = await firstValueFrom(
      interceptor.intercept(rpcContext({ userId: 'u-1' }), {
        handle: () => of(getTenantContext()),
      }),
    );
    expect(observed).toBeUndefined();
  });

  it('en HTTP prioriza req.user sobre el body', async () => {
    const interceptor = new RpcTenantContextInterceptor();
    const context = httpContext({
      user: { tenantId: 'from-jwt', userId: 'u-1', role: UserRole.ACCOUNTANT },
      tenantId: 'from-body',
      userId: 'spoofed',
      role: UserRole.SUPER_ADMIN,
    });
    const observed = await firstValueFrom(
      interceptor.intercept(context, { handle: () => of(getTenantContext()) }),
    );
    expect(observed?.tenantId).toBe('from-jwt');
    expect(observed?.role).toBe(UserRole.ACCOUNTANT);
  });
});
