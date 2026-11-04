import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { UserRole } from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../src/database/database.service';
import { bankAccounts, bankConnections, bankTransactions } from '../src/database/schema';
import { CashflowService } from '../src/cashflow/cashflow.service';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

type TxType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

interface SeedTransaction {
  amountMinor: bigint;
  type: TxType;
  date: string;
  isoCurrencyCode?: string;
  category?: string[] | null;
}

interface SeedOptions {
  currency?: string;
  balanceMinor?: bigint;
  transactions?: SeedTransaction[];
}

describeIfDb('CashflowService (integración PostgreSQL)', () => {
  let database: FinanceDatabaseService;
  let service: CashflowService;

  const tenantIds: string[] = [];
  const accountIds: string[] = [];
  const connectionIds: string[] = [];
  const userId = randomUUID();

  function newTenant(): string {
    const tenantId = randomUUID();
    tenantIds.push(tenantId);
    return tenantId;
  }

  /**
   * Crea la cadena completa `bank_connections` → `bank_accounts` →
   * `bank_transactions` respetando las columnas `NOT NULL` del esquema.
   */
  async function seedTenant(options: SeedOptions = {}): Promise<{
    tenantId: string;
    accountId: string;
  }> {
    const tenantId = newTenant();
    const currency = options.currency ?? 'COP';

    const [connection] = await database.db
      .insert(bankConnections)
      .values({
        userId,
        tenantId,
        provider: 'plaid',
        providerItemId: `item-${randomUUID()}`,
        accessTokenCiphertext: 'ciphertext-de-prueba',
      })
      .returning({ id: bankConnections.id });
    connectionIds.push(connection.id);

    const [account] = await database.db
      .insert(bankAccounts)
      .values({
        tenantId,
        connectionId: connection.id,
        providerAccountId: `acc-${randomUUID()}`,
        institutionName: 'Banco de Pruebas',
        accountNumberMasked: '****1234',
        currency,
        isoCurrencyCode: currency,
        currentBalanceMinor: options.balanceMinor ?? 0n,
      })
      .returning({ id: bankAccounts.id });
    accountIds.push(account.id);

    const transactions = options.transactions ?? [];
    if (transactions.length > 0) {
      await database.db.insert(bankTransactions).values(
        transactions.map((tx) => ({
          accountId: account.id,
          connectionId: connection.id,
          providerTransactionId: `tx-${randomUUID()}`,
          amountMinor: tx.amountMinor,
          transactionType: tx.type,
          isoCurrencyCode: tx.isoCurrencyCode ?? currency,
          date: tx.date,
          name: 'Movimiento de prueba',
          category: tx.category ?? [],
        })),
      );
    }

    return { tenantId, accountId: account.id };
  }

  function contextFor(tenantId: string) {
    return { tenantId, userId, role: UserRole.TENANT_ADMIN };
  }

  beforeAll(() => {
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    service = new CashflowService(database);
  });

  afterAll(async () => {
    if (accountIds.length > 0) {
      await database.db
        .delete(bankTransactions)
        .where(inArray(bankTransactions.accountId, accountIds));
      await database.db.delete(bankAccounts).where(inArray(bankAccounts.id, accountIds));
    }
    if (connectionIds.length > 0) {
      await database.db.delete(bankConnections).where(inArray(bankConnections.id, connectionIds));
    }
    await database.onModuleDestroy();
  });

  it('suma ingresos y egresos ignorando las transferencias', async () => {
    const { tenantId } = await seedTenant({
      currency: 'COP',
      balanceMinor: 500000n,
      transactions: [
        { amountMinor: 100000n, type: 'INCOME', date: '2026-10-02', category: ['Ventas'] },
        { amountMinor: 50000n, type: 'INCOME', date: '2026-10-03', category: ['Ventas'] },
        { amountMinor: 30000n, type: 'EXPENSE', date: '2026-10-04', category: ['Nómina'] },
        { amountMinor: 90000n, type: 'TRANSFER', date: '2026-10-05', category: ['Ahorro'] },
      ],
    });

    const summary = await service.getCashflowSummary({
      ...contextFor(tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: false,
    });

    expect(summary.hasData).toBe(true);
    expect(summary.currency).toBe('COP');
    expect(summary.incomeMinor).toBe('150000');
    expect(summary.expenseMinor).toBe('30000');
    expect(summary.balanceMinor).toBe('500000');
    expect(summary.categories.map((c) => c.category)).toEqual(['Nómina']);
  });

  it('no suma transacciones en USD dentro de una cuenta COP', async () => {
    const { tenantId } = await seedTenant({
      currency: 'COP',
      balanceMinor: 1000000n,
      transactions: [
        { amountMinor: 200000n, type: 'INCOME', date: '2026-10-06', isoCurrencyCode: 'COP' },
        { amountMinor: 700000n, type: 'INCOME', date: '2026-10-07', isoCurrencyCode: 'USD' },
        { amountMinor: 500000n, type: 'EXPENSE', date: '2026-10-08', isoCurrencyCode: 'USD' },
      ],
    });

    const summary = await service.getCashflowSummary({
      ...contextFor(tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: false,
    });

    expect(summary.incomeMinor).toBe('200000');
    expect(summary.expenseMinor).toBe('0');
    expect(summary.burnRateMinor).toBeNull();
  });

  it('aísla los totales por tenant', async () => {
    const tenantA = await seedTenant({
      currency: 'COP',
      balanceMinor: 100000n,
      transactions: [{ amountMinor: 100000n, type: 'INCOME', date: '2026-10-09' }],
    });
    const tenantB = await seedTenant({
      currency: 'COP',
      balanceMinor: 999000n,
      transactions: [{ amountMinor: 999000n, type: 'INCOME', date: '2026-10-09' }],
    });

    const summaryA = await service.getCashflowSummary({
      ...contextFor(tenantA.tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: false,
    });

    expect(summaryA.incomeMinor).toBe('100000');
    expect(summaryA.balanceMinor).toBe('100000');
    expect(summaryA.availableCurrencies).toEqual(['COP']);

    const summaryB = await service.getCashflowSummary({
      ...contextFor(tenantB.tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: false,
    });

    expect(summaryB.incomeMinor).toBe('999000');
  });

  it('devuelve hasData=false y balance null si el rango no tiene movimientos', async () => {
    const { tenantId } = await seedTenant({
      currency: 'COP',
      balanceMinor: 750000n,
      transactions: [{ amountMinor: 40000n, type: 'INCOME', date: '2026-10-15' }],
    });

    const summary = await service.getCashflowSummary({
      ...contextFor(tenantId),
      from: '2026-11-01',
      to: '2026-11-30',
      currency: 'COP',
      compare: true,
    });

    expect(summary.hasData).toBe(false);
    expect(summary.balanceMinor).toBeNull();
    expect(summary.incomeMinor).toBeNull();
    expect(summary.expenseMinor).toBeNull();
    expect(summary.previousPeriod).toBeNull();
    expect(summary.series).toEqual([]);
  });

  it('calcula previousPeriod con el rango inmediatamente anterior', async () => {
    const { tenantId } = await seedTenant({
      currency: 'COP',
      balanceMinor: 300000n,
      transactions: [
        { amountMinor: 10000n, type: 'INCOME', date: '2026-10-10' },
        { amountMinor: 40000n, type: 'INCOME', date: '2026-09-15' },
        { amountMinor: 7000n, type: 'EXPENSE', date: '2026-09-20', category: ['Servicios'] },
        { amountMinor: 50000n, type: 'INCOME', date: '2026-08-31' },
      ],
    });

    const summary = await service.getCashflowSummary({
      ...contextFor(tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: true,
    });

    expect(summary.incomeMinor).toBe('10000');
    expect(summary.previousPeriod).toEqual({ incomeMinor: '40000', expenseMinor: '7000' });
  });

  it('agrupa una fecha ISO con hora en su día natural', async () => {
    const { tenantId } = await seedTenant({
      currency: 'COP',
      balanceMinor: 200000n,
      transactions: [
        {
          amountMinor: 25000n,
          type: 'INCOME',
          date: '2026-10-15T13:45:00.000Z',
        },
      ],
    });

    const summary = await service.getCashflowSummary({
      ...contextFor(tenantId),
      from: '2026-10-01',
      to: '2026-10-30',
      currency: 'COP',
      compare: false,
    });

    expect(summary.hasData).toBe(true);
    const day = summary.series.find((bucket) => bucket.bucketStart === '2026-10-15');
    expect(day).toEqual({
      bucketStart: '2026-10-15',
      incomeMinor: '25000',
      expenseMinor: '0',
    });
    expect(summary.series).toHaveLength(30);
  });
});
