import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ConfigService } from '@nestjs/config';
import { FinanceDatabaseService } from '../src/database/database.service';
import { FinanceRepository, DuplicateInvoiceNumberError } from '../src/finance.repository';
import { bankAccounts, invoices, transactions } from '../src/database/schema';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

describeIf('FinanceRepository (integración PostgreSQL)', () => {
  let database: FinanceDatabaseService;
  let repository: FinanceRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  let accountAId: string;
  let accountBId: string;

  beforeAll(async () => {
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    repository = new FinanceRepository(database);

    const accountA = await repository.createAccount({
      tenantId: tenantA,
      institutionName: 'Banco Tenant A',
      accountType: 'CHECKING',
      accountNumberMasked: '****000A',
      currency: 'COP',
      initialBalanceMinor: 9007199254740993n,
    });
    accountAId = accountA.id;

    const accountB = await repository.createAccount({
      tenantId: tenantB,
      institutionName: 'Banco Tenant B',
      accountType: 'SAVINGS',
      accountNumberMasked: '****000B',
      currency: 'COP',
      initialBalanceMinor: 500000n,
    });
    accountBId = accountB.id;
  });

  afterAll(async () => {
    await database.db.delete(invoices).where(eq(invoices.tenantId, tenantA));
    await database.db.delete(invoices).where(eq(invoices.tenantId, tenantB));
    await database.db.delete(transactions).where(eq(transactions.tenantId, tenantA));
    await database.db.delete(transactions).where(eq(transactions.tenantId, tenantB));
    await database.db.delete(bankAccounts).where(eq(bankAccounts.tenantId, tenantA));
    await database.db.delete(bankAccounts).where(eq(bankAccounts.tenantId, tenantB));
    await database.onModuleDestroy();
  });

  it('crea una cuenta y la recupera conservando el saldo exacto', async () => {
    const account = await repository.findAccountById(tenantA, accountAId);

    expect(account).not.toBeNull();
    expect(account?.id).toBe(accountAId);
    expect(account?.tenantId).toBe(tenantA);
    expect(account?.currentBalanceMinor).toBe(9007199254740993n);
  });

  it('persiste amountMinor mayor que Number.MAX_SAFE_INTEGER como bigint exacto', async () => {
    const result = await repository.createTransactionIdempotent({
      tenantId: tenantA,
      bankAccountId: accountAId,
      amountMinor: 9007199254740993n,
      currency: 'COP',
      type: 'EXPENSE',
      description: 'Monto fuera de rango seguro',
      idempotencyKey: `big-${randomUUID()}`,
    });

    const stored = await repository.findTransactionById(tenantA, result.transaction.id);

    expect(stored).not.toBeNull();
    expect(stored?.amountMinor).toBe(9007199254740993n);
    expect(stored?.amountMinor.toString()).toBe('9007199254740993');
  });

  it('es idempotente con la misma (tenantId, idempotencyKey)', async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    const first = await repository.createTransactionIdempotent({
      tenantId: tenantA,
      bankAccountId: accountAId,
      amountMinor: 1000n,
      currency: 'COP',
      type: 'INCOME',
      description: 'Primera llamada',
      idempotencyKey,
    });
    const second = await repository.createTransactionIdempotent({
      tenantId: tenantA,
      bankAccountId: accountAId,
      amountMinor: 1000n,
      currency: 'COP',
      type: 'INCOME',
      description: 'Reintento',
      idempotencyKey,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transaction.id).toBe(first.transaction.id);
  });

  it('la misma idempotencyKey en otro tenant crea una transacción distinta', async () => {
    const idempotencyKey = `shared-${randomUUID()}`;
    const first = await repository.createTransactionIdempotent({
      tenantId: tenantA,
      bankAccountId: accountAId,
      amountMinor: 2000n,
      currency: 'COP',
      type: 'INCOME',
      description: 'Tenant A',
      idempotencyKey,
    });
    const second = await repository.createTransactionIdempotent({
      tenantId: tenantB,
      bankAccountId: accountBId,
      amountMinor: 2000n,
      currency: 'COP',
      type: 'INCOME',
      description: 'Tenant B',
      idempotencyKey,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.transaction.id).not.toBe(first.transaction.id);
  });

  it('findAccountById no cruza tenants', async () => {
    const account = await repository.findAccountById(tenantB, accountAId);

    expect(account).toBeNull();
  });

  it('createInvoice rechaza un invoiceNumber duplicado en el mismo tenant', async () => {
    const invoiceNumber = `INV-${randomUUID()}`;
    const record = {
      tenantId: tenantA,
      invoiceNumber,
      counterpartyName: 'Cliente A',
      counterpartyTaxId: '900123456',
      subtotalMinor: 100000n,
      taxAmountMinor: 19000n,
      totalAmountMinor: 119000n,
      currency: 'COP',
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
    };

    const first = await repository.createInvoice(record);

    expect(first.invoiceNumber).toBe(invoiceNumber);
    await expect(repository.createInvoice(record)).rejects.toBeInstanceOf(
      DuplicateInvoiceNumberError,
    );
  });

  it('markInvoicePaid no modifica facturas de otro tenant', async () => {
    const invoice = await repository.createInvoice({
      tenantId: tenantA,
      invoiceNumber: `INV-ISO-${randomUUID()}`,
      counterpartyName: 'Cliente A',
      counterpartyTaxId: '900123456',
      subtotalMinor: 50000n,
      taxAmountMinor: 9500n,
      totalAmountMinor: 59500n,
      currency: 'COP',
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
    });

    const result = await repository.markInvoicePaid(tenantB, invoice.id);
    const stillDraft = await repository.findInvoiceById(tenantA, invoice.id);

    expect(result).toBeNull();
    expect(stillDraft?.status).toBe('DRAFT');
  });

  it('findTransactionById no cruza tenants', async () => {
    const created = await repository.createTransactionIdempotent({
      tenantId: tenantA,
      bankAccountId: accountAId,
      amountMinor: 3000n,
      currency: 'COP',
      type: 'EXPENSE',
      description: 'Aislada',
      idempotencyKey: `iso-${randomUUID()}`,
    });

    const found = await repository.findTransactionById(tenantB, created.transaction.id);

    expect(found).toBeNull();
  });
});
