import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
  RolesGuard,
  TenantGuard,
  extractRpcContext,
  stripRpcContext,
} from '@mybusiness/common';
import { UserRole } from '@mybusiness/contracts';

function httpContext(request: Record<string, any>): any {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function reflectorWith(metadata: { isPublic?: boolean; roles?: UserRole[] }): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return metadata.isPublic;
      }
      if (key === ROLES_KEY) {
        return metadata.roles;
      }
      return undefined;
    }),
  } as unknown as Reflector;
}

describe('extractRpcContext (Unit)', () => {
  it('extrae tenantId, userId y role de un payload plano', () => {
    const ctx = extractRpcContext({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
      amountMinor: '100',
    });

    expect(ctx).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
    });
  });

  it('tolera payloads anidados bajo user (auth.getProfile)', () => {
    const ctx = extractRpcContext({
      user: {
        userId: 'user-2',
        tenantId: 'tenant-2',
        email: 'user@example.com',
        role: UserRole.TENANT_ADMIN,
      },
    });

    expect(ctx).toEqual({
      tenantId: 'tenant-2',
      userId: 'user-2',
      role: UserRole.TENANT_ADMIN,
    });
  });

  it('usa id como alias de userId y devuelve strings vacíos si faltan datos', () => {
    expect(extractRpcContext({ id: 'user-3', tenantId: 'tenant-3' })).toEqual({
      tenantId: 'tenant-3',
      userId: 'user-3',
      role: undefined,
    });

    expect(extractRpcContext(null)).toEqual({ tenantId: '', userId: '', role: undefined });
  });
});

describe('stripRpcContext (Unit)', () => {
  it('elimina las propiedades de contexto y conserva el resto del payload', () => {
    const payload = stripRpcContext({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
      amountMinor: '100',
      description: 'Compra',
    });

    expect(payload).toEqual({ amountMinor: '100', description: 'Compra' });
  });
});

describe('RolesGuard (Unit)', () => {
  it('permite rutas públicas sin evaluar roles', () => {
    const guard = new RolesGuard(reflectorWith({ isPublic: true, roles: [UserRole.SUPER_ADMIN] }));
    expect(guard.canActivate(httpContext({}))).toBe(true);
  });

  it('permite cuando el handler no declara roles', () => {
    const guard = new RolesGuard(reflectorWith({}));
    expect(guard.canActivate(httpContext({ user: { role: UserRole.VIEWER } }))).toBe(true);
  });

  it('permite cuando el rol del usuario está autorizado', () => {
    const guard = new RolesGuard(
      reflectorWith({ roles: [UserRole.ACCOUNTANT, UserRole.TENANT_ADMIN] }),
    );
    expect(guard.canActivate(httpContext({ user: { role: UserRole.ACCOUNTANT } }))).toBe(true);
  });

  it('deniega cuando el rol no está autorizado', () => {
    const guard = new RolesGuard(reflectorWith({ roles: [UserRole.TENANT_ADMIN] }));
    expect(guard.canActivate(httpContext({ user: { role: UserRole.VIEWER } }))).toBe(false);
  });

  it('deniega cuando no hay usuario autenticado', () => {
    const guard = new RolesGuard(reflectorWith({ roles: [UserRole.TENANT_ADMIN] }));
    expect(guard.canActivate(httpContext({}))).toBe(false);
  });
});

describe('TenantGuard (Unit)', () => {
  it('permite rutas públicas sin tenant', () => {
    const guard = new TenantGuard(reflectorWith({ isPublic: true }));
    expect(guard.canActivate(httpContext({}))).toBe(true);
  });

  it('permite cuando el usuario autenticado tiene tenantId', () => {
    const guard = new TenantGuard(reflectorWith({}));
    expect(guard.canActivate(httpContext({ user: { tenantId: 'tenant-1' } }))).toBe(true);
  });

  it('permite el fallback x-tenant-id cuando no hay usuario', () => {
    const guard = new TenantGuard(reflectorWith({}));
    expect(guard.canActivate(httpContext({ headers: { 'x-tenant-id': 'tenant-1' } }))).toBe(true);
  });

  it('lanza Unauthorized cuando falta el contexto de tenant', () => {
    const guard = new TenantGuard(reflectorWith({}));
    expect(() => guard.canActivate(httpContext({ headers: {} }))).toThrow(UnauthorizedException);
  });
});
