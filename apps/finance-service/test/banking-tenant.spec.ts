import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BankConnectionStatus, BankProvider, RequestContext } from '@mybusiness/contracts';
import { BankingService } from '../src/banking/banking.service';
import { BankingEncryptionService } from '../src/banking/banking-encryption.service';

describe('BankingService Tenant Isolation (SEC-04)', () => {
  let encryptionService: BankingEncryptionService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({
      BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      BANK_ENCRYPTION_KEY_VERSION: 'v1',
    });
    encryptionService = new BankingEncryptionService(configService);
  });

  it('1. getConnections incluye tenant_id y el valor de ctx.tenantId en el SQL', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      orderBy: vi.fn().mockResolvedValue([]),
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN' as any,
    };

    await service.getConnections(ctx);

    expect(whereSpy).toHaveBeenCalledTimes(1);
    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('tenant-A');
  });

  it('2. Mismo userId, distinto tenantId: getConnectionAccounts lanza NotFoundException', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      limit: vi.fn().mockResolvedValue([]), // No coincide tenantId
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-B', // Intento de acceso desde tenant B a conexión de tenant A
      role: 'TENANT_ADMIN' as any,
    };

    await expect(service.getConnectionAccounts(ctx, 'conn-tenant-A')).rejects.toThrow(
      NotFoundException,
    );

    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"user_id"');
    expect(params).toContain('tenant-B');
    expect(params).toContain('user-1');
  });

  it('3. Mismo userId, distinto tenantId: syncConnection lanza NotFoundException', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-B',
      role: 'TENANT_ADMIN' as any,
    };

    await expect(service.syncConnection(ctx, 'conn-tenant-A')).rejects.toThrow(NotFoundException);

    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('tenant-B');
  });

  it('4. Mismo userId, distinto tenantId: disconnectConnection lanza NotFoundException', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-B',
      role: 'TENANT_ADMIN' as any,
    };

    await expect(service.disconnectConnection(ctx, 'conn-tenant-A')).rejects.toThrow(
      NotFoundException,
    );

    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"tenant_id"');
    expect(params).toContain('tenant-B');
  });

  it('5. Mismo tenantId, distinto userId: también lanza NotFoundException (404)', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      limit: vi.fn().mockResolvedValue([]), // No coincide userId
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-different',
      tenantId: 'tenant-A',
      role: 'VIEWER' as any,
    };

    await expect(service.getConnectionAccounts(ctx, 'conn-tenant-A')).rejects.toThrow(
      NotFoundException,
    );

    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"user_id"');
    expect(params).toContain('tenant-A');
    expect(params).toContain('user-different');
  });

  it('6. getConnections sigue filtrando deleted_at IS NULL y user_id', async () => {
    const whereSpy = vi.fn().mockReturnThis();
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: whereSpy,
      orderBy: vi.fn().mockResolvedValue([]),
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN' as any,
    };

    await service.getConnections(ctx);

    const condition = whereSpy.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).toContain('"user_id"');
    expect(params).toContain('user-1');
  });

  it('permite acceso si coinciden userId y tenantId', async () => {
    const existingConnection = {
      id: 'conn-1',
      userId: 'user-1',
      tenantId: 'tenant-A',
      provider: BankProvider.PLAID,
      providerItemId: 'item-1',
      accessTokenCiphertext: 'iv:tag:enc',
      tokenKeyVersion: 'v1',
      status: BankConnectionStatus.ACTIVE,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([existingConnection]),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    };
    const mockDbService = { db: mockDb } as any;
    const service = new BankingService(
      mockDbService,
      {} as any,
      encryptionService,
      {} as any,
      configService,
    );

    const ctx: RequestContext = {
      userId: 'user-1',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN' as any,
    };

    const accounts = await service.getConnectionAccounts(ctx, 'conn-1');
    expect(accounts).toEqual([]);
  });
});
