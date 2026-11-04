import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { ValidationPipe, ArgumentMetadata } from '@nestjs/common';
import {
  CashflowPatterns,
  CashflowSummaryQueryDto,
  UserRole,
  type UserContext,
} from '@mybusiness/contracts';
import { FinanceGatewayController } from '../src/finance/finance-gateway.controller';

const user: UserContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  email: 'ada@example.com',
  role: UserRole.MEMBER,
};

describe('FinanceGatewayController - Cashflow', () => {
  let send: ReturnType<typeof vi.fn>;
  let controller: FinanceGatewayController;
  let validationPipe: ValidationPipe;

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({ hasData: true }));
    const client = { send } as unknown as ClientProxy;
    controller = new FinanceGatewayController(client);
    validationPipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
  });

  it('propaga contexto de tenant, usuario y parámetros de query al RPC', async () => {
    const query: CashflowSummaryQueryDto = {
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'USD',
      compare: true,
    };

    await controller.getCashflowSummary(user, query);

    expect(send).toHaveBeenCalledWith(CashflowPatterns.SUMMARY, {
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'USD',
      compare: true,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  });

  it('no permite sobrescribir tenantId desde la query (tenant isolation)', async () => {
    const maliciousQuery = {
      from: '2026-10-01',
      to: '2026-10-30',
      tenantId: 'hacked-tenant',
    } as unknown as CashflowSummaryQueryDto;

    await controller.getCashflowSummary(user, maliciousQuery);

    expect(send).toHaveBeenCalledWith(
      CashflowPatterns.SUMMARY,
      expect.objectContaining({
        tenantId: user.tenantId, // Debe usar el del usuario autenticado
      }),
    );
  });

  describe('CashflowSummaryQueryDto validación', () => {
    const metadata: ArgumentMetadata = {
      type: 'query',
      metatype: CashflowSummaryQueryDto,
    };

    it('acepta query válida con fechas y moneda', async () => {
      const valid = {
        from: '2026-10-01',
        to: '2026-10-30',
        currency: 'EUR',
        compare: 'true',
      };

      const transformed = await validationPipe.transform(valid, metadata);
      expect(transformed).toBeInstanceOf(CashflowSummaryQueryDto);
      expect(transformed.compare).toBe(true);
      expect(transformed.currency).toBe('EUR');
    });

    it('rechaza formato inválido en from', async () => {
      const invalid = {
        from: '01/10/2026',
        to: '2026-10-30',
      };

      await expect(validationPipe.transform(invalid, metadata)).rejects.toThrow();
    });

    it('rechaza formato inválido en to', async () => {
      const invalid = {
        from: '2026-10-01',
        to: '2026-10',
      };

      await expect(validationPipe.transform(invalid, metadata)).rejects.toThrow();
    });

    it('rechaza código de moneda inválido', async () => {
      const invalid = {
        from: '2026-10-01',
        to: '2026-10-30',
        currency: 'EUROPE',
      };

      await expect(validationPipe.transform(invalid, metadata)).rejects.toThrow();
    });
  });
});
