import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@mybusiness/contracts';
import type { FinanceDatabaseService } from '../src/database/database.service';
import { CashflowService } from '../src/cashflow/cashflow.service';
import { CashflowController } from '../src/cashflow/cashflow.controller';

const ctx = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  role: UserRole.TENANT_ADMIN,
};

interface MockAccount {
  id: string;
  currency: string;
  currentBalanceMinor: bigint;
}

interface MockTransaction {
  id: string;
  amountMinor: bigint;
  transactionType: string;
  isoCurrencyCode?: string;
  date: string;
  category: string[] | null;
}

interface MockDbOptions {
  accounts?: MockAccount[];
  transactions?: MockTransaction[];
  previousTransactions?: MockTransaction[];
}

function createMockDb(options: MockDbOptions) {
  let selectCallCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      const currentCall = selectCallCount;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(async () => {
            if (currentCall === 1) return options.accounts ?? [];
            if (currentCall === 2) return options.transactions ?? [];
            if (currentCall === 3) return options.previousTransactions ?? [];
            return [];
          }),
        }),
      };
    }),
  };
}

describe('CashflowService', () => {
  it('lanza BadRequestException si falta tenantId en el contexto', async () => {
    const mockDb = createMockDb({});
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    await expect(
      service.getCashflowSummary({
        tenantId: '',
        userId: 'u1',
        role: UserRole.TENANT_ADMIN,
        from: '2026-10-01',
        to: '2026-10-30',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('valida formato de fecha YYYY-MM-DD', async () => {
    const mockDb = createMockDb({});
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    await expect(
      service.getCashflowSummary({
        ...ctx,
        from: '01-10-2026',
        to: '2026-10-30',
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('rechaza fechas inexistentes (ej. 2026-02-31)', async () => {
    const mockDb = createMockDb({});
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    await expect(
      service.getCashflowSummary({
        ...ctx,
        from: '2026-02-31',
        to: '2026-03-10',
      }),
    ).rejects.toThrow(/Fecha inválida/);
  });

  it('rechaza si from > to', async () => {
    const mockDb = createMockDb({});
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    await expect(
      service.getCashflowSummary({
        ...ctx,
        from: '2026-10-31',
        to: '2026-10-01',
      }),
    ).rejects.toThrow(/no puede ser posterior/);
  });

  it('rechaza rangos mayores a 366 días', async () => {
    const mockDb = createMockDb({});
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    await expect(
      service.getCashflowSummary({
        ...ctx,
        from: '2025-01-01',
        to: '2026-02-01', // > 366 días
      }),
    ).rejects.toThrow(/no puede exceder 366 días/);
  });

  it('devuelve hasData=false si el tenant no tiene cuentas bancarias', async () => {
    const mockDb = createMockDb({ accounts: [] });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'USD',
    });

    expect(result.hasData).toBe(false);
    expect(result.currency).toBe('USD');
    expect(result.availableCurrencies).toEqual([]);
    expect(result.balanceMinor).toBeNull();
    expect(result.incomeMinor).toBeNull();
    expect(result.expenseMinor).toBeNull();
    expect(result.burnRateMinor).toBeNull();
    expect(result.runwayMonths).toBeNull();
    expect(result.series).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  it('devuelve hasData=false si hay cuentas pero no movimientos en el período', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'COP', currentBalanceMinor: 5000000n }],
      transactions: [],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
    });

    expect(result.hasData).toBe(false);
    expect(result.currency).toBe('COP');
    expect(result.availableCurrencies).toEqual(['COP']);
    expect(result.balanceMinor).toBeNull();
    expect(result.incomeMinor).toBeNull();
    expect(result.expenseMinor).toBeNull();
  });

  it('devuelve hasData=false si la moneda solicitada no existe en las cuentas', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'COP', currentBalanceMinor: 5000000n }],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'EUR',
    });

    expect(result.hasData).toBe(false);
    expect(result.currency).toBe('EUR');
    expect(result.availableCurrencies).toEqual(['COP']);
    expect(result.balanceMinor).toBeNull();
  });

  it('calcula métricas completas para período diario (<= 90 días)', async () => {
    const mockDb = createMockDb({
      accounts: [
        { id: 'acc-1', currency: 'USD', currentBalanceMinor: 600000n },
        { id: 'acc-2', currency: 'USD', currentBalanceMinor: 400000n },
        { id: 'acc-3', currency: 'EUR', currentBalanceMinor: 100000n },
      ],
      transactions: [
        {
          id: 'tx-1',
          amountMinor: 30000n,
          transactionType: 'INCOME',
          date: '2026-10-02',
          category: ['Ventas'],
        },
        {
          id: 'tx-2',
          amountMinor: 10000n,
          transactionType: 'EXPENSE',
          date: '2026-10-02',
          category: ['Software', 'SaaS'],
        },
        {
          id: 'tx-3',
          amountMinor: 20000n,
          transactionType: 'EXPENSE',
          date: '2026-10-15',
          category: null, // "Sin categoría"
        },
        {
          id: 'tx-4',
          amountMinor: 50000n,
          transactionType: 'TRANSFER', // debe ser ignorada
          date: '2026-10-10',
          category: ['Transferencia'],
        },
      ],
      previousTransactions: [
        {
          id: 'prev-1',
          amountMinor: 25000n,
          transactionType: 'INCOME',
          date: '2026-09-15',
        },
        {
          id: 'prev-2',
          amountMinor: 15000n,
          transactionType: 'EXPENSE',
          date: '2026-09-20',
        },
      ],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    // 30 días (del 2026-10-01 al 2026-10-30)
    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'USD',
      compare: true,
    });

    expect(result.hasData).toBe(true);
    expect(result.currency).toBe('USD');
    expect(result.availableCurrencies).toEqual(
      ['COP', 'EUR', 'USD'].filter((c) => ['EUR', 'USD'].includes(c)),
    );
    // Saldo consolidado = 600000 + 400000 = 1000000
    expect(result.balanceMinor).toBe('1000000');
    expect(result.incomeMinor).toBe('30000');
    expect(result.expenseMinor).toBe('30000'); // tx-2 (10000) + tx-3 (20000)

    // Burn rate para 30 días con 30000 de egresos = 30000
    expect(result.burnRateMinor).toBe('30000');
    // Runway = 1000000 / 30000 = 33.3 meses
    expect(result.runwayMonths).toBe(33.3);

    // Comparación período anterior
    expect(result.previousPeriod).toEqual({
      incomeMinor: '25000',
      expenseMinor: '15000',
    });

    // Serie diaria: 30 días continuos
    expect(result.series).toHaveLength(30);
    const day2 = result.series.find((b) => b.bucketStart === '2026-10-02');
    expect(day2).toEqual({
      bucketStart: '2026-10-02',
      incomeMinor: '30000',
      expenseMinor: '10000',
    });
    const emptyDay = result.series.find((b) => b.bucketStart === '2026-10-01');
    expect(emptyDay).toEqual({
      bucketStart: '2026-10-01',
      incomeMinor: '0',
      expenseMinor: '0',
    });

    // Categorías: top 10
    expect(result.categories).toHaveLength(2);
    expect(result.categories[0]).toEqual({
      category: 'Sin categoría',
      amountMinor: '20000',
      share: 0.6667,
    });
    expect(result.categories[1]).toEqual({
      category: 'Software',
      amountMinor: '10000',
      share: 0.3333,
    });
  });

  it('resuelve automáticamente la moneda principal si currency no es enviada', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'COP', currentBalanceMinor: 2000000n }],
      transactions: [
        {
          id: 'tx-1',
          amountMinor: 50000n,
          transactionType: 'INCOME',
          date: '2026-10-05',
          category: [],
        },
      ],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
    });

    expect(result.currency).toBe('COP');
    expect(result.hasData).toBe(true);
    expect(result.balanceMinor).toBe('2000000');
  });

  it('genera buckets mensuales si el rango > 90 días', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'USD', currentBalanceMinor: 1000000n }],
      transactions: [
        {
          id: 'tx-1',
          amountMinor: 50000n,
          transactionType: 'INCOME',
          date: '2026-01-15',
          category: [],
        },
        {
          id: 'tx-2',
          amountMinor: 20000n,
          transactionType: 'EXPENSE',
          date: '2026-03-20',
          category: [],
        },
      ],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    // 120 días
    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-01-01',
      to: '2026-04-30',
      compare: false,
    });

    expect(result.hasData).toBe(true);
    expect(result.previousPeriod).toBeNull();
    // 4 meses: Jan, Feb, Mar, Apr
    expect(result.series).toHaveLength(4);
    expect(result.series[0].bucketStart).toBe('2026-01-01');
    expect(result.series[0].incomeMinor).toBe('50000');
    expect(result.series[2].bucketStart).toBe('2026-03-01');
    expect(result.series[2].expenseMinor).toBe('20000');
  });

  it('maneja caso borde de 0 egresos: burnRate y runway son null', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'USD', currentBalanceMinor: 500000n }],
      transactions: [
        {
          id: 'tx-1',
          amountMinor: 40000n,
          transactionType: 'INCOME',
          date: '2026-10-05',
          category: [],
        },
      ],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
      compare: false,
    });

    expect(result.hasData).toBe(true);
    expect(result.expenseMinor).toBe('0');
    expect(result.burnRateMinor).toBeNull();
    expect(result.runwayMonths).toBeNull();
    expect(result.categories).toEqual([]);
  });

  it('maneja saldo <= 0 con egresos: runway es 0', async () => {
    const mockDb = createMockDb({
      accounts: [{ id: 'acc-1', currency: 'USD', currentBalanceMinor: 0n }],
      transactions: [
        {
          id: 'tx-1',
          amountMinor: 20000n,
          transactionType: 'EXPENSE',
          date: '2026-10-05',
          category: ['Servicios'],
        },
      ],
    });
    const service = new CashflowService({ db: mockDb } as unknown as FinanceDatabaseService);

    const result = await service.getCashflowSummary({
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
      compare: false,
    });

    expect(result.hasData).toBe(true);
    expect(result.runwayMonths).toBe(0);
  });
});

describe('CashflowController', () => {
  it('delega getSummary al servicio', async () => {
    const mockService = {
      getCashflowSummary: vi.fn().mockResolvedValue({ hasData: false }),
    };
    const controller = new CashflowController(mockService as unknown as CashflowService);

    const payload = {
      ...ctx,
      from: '2026-10-01',
      to: '2026-10-30',
    };

    const res = await controller.getSummary(payload);
    expect(res).toEqual({ hasData: false });
    expect(mockService.getCashflowSummary).toHaveBeenCalledWith(payload);
  });
});
