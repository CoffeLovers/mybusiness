import { describe, it, expect } from 'vitest';
import { AccountType, TransactionType, UserRole, type RequestContext } from '@mybusiness/contracts';
import { FinanceService } from '../src/finance.service';

const tenantA: RequestContext = {
  tenantId: 'tenant-A',
  userId: 'user-A',
  role: UserRole.ACCOUNTANT,
};

const tenantB: RequestContext = {
  tenantId: 'tenant-B',
  userId: 'user-B',
  role: UserRole.ACCOUNTANT,
};

function transactionDto(idempotencyKey = 'idem-A') {
  return {
    bankAccountId: 'acc-1',
    amountMinor: '150000',
    currency: 'COP',
    type: TransactionType.EXPENSE,
    description: 'Gasto tenant A',
    idempotencyKey,
  };
}

describe('FinanceService — aislamiento multi-tenant', () => {
  it('las transacciones creadas por tenant A no son visibles para tenant B', async () => {
    const service = new FinanceService();

    await service.createTransaction(tenantA, transactionDto('idem-isolation'));

    const transactionsA = await service.getTransactions(tenantA);
    const transactionsB = await service.getTransactions(tenantB);

    expect(transactionsA.some((tx) => tx.description === 'Gasto tenant A')).toBe(true);
    expect(transactionsB.some((tx) => tx.description === 'Gasto tenant A')).toBe(false);
    expect(transactionsB.every((tx) => tx.tenantId === 'tenant-B')).toBe(true);
    expect(transactionsA.every((tx) => tx.tenantId === 'tenant-A')).toBe(true);
  });

  it('las cuentas creadas por tenant A no son visibles para tenant B', async () => {
    const service = new FinanceService();

    await service.createAccount(tenantA, {
      institutionName: 'Banco A',
      accountType: AccountType.CHECKING,
      accountNumberMasked: '****1111',
      currency: 'COP',
    });

    const accountsA = await service.getAccounts(tenantA);
    const accountsB = await service.getAccounts(tenantB);

    expect(accountsA.some((account) => account.institutionName === 'Banco A')).toBe(true);
    expect(accountsB.some((account) => account.institutionName === 'Banco A')).toBe(false);
  });

  it('la idempotencia está particionada por tenant', async () => {
    const service = new FinanceService();

    const first = await service.createTransaction(tenantA, transactionDto('shared-key'));
    const second = await service.createTransaction(tenantB, transactionDto('shared-key'));
    const repeated = await service.createTransaction(tenantA, transactionDto('shared-key'));

    expect(first.tenantId).toBe('tenant-A');
    expect(second.tenantId).toBe('tenant-B');
    expect(second.id).not.toBe(first.id);
    expect(repeated.id).toBe(first.id);
  });

  it('el tenantId del contexto prevalece sobre un dto manipulado', async () => {
    const service = new FinanceService();

    const created = await service.createAccount(tenantA, {
      institutionName: 'Banco A',
      accountType: AccountType.CHECKING,
      accountNumberMasked: '****2222',
      currency: 'COP',
      tenantId: 'tenant-B',
    } as any);

    expect(created.tenantId).toBe('tenant-A');
  });

  it('las facturas creadas por tenant A no son visibles para tenant B', async () => {
    const service = new FinanceService();

    await service.createInvoice(tenantA, {
      invoiceNumber: 'INV-A-1',
      counterpartyName: 'Proveedor A',
      counterpartyTaxId: '900111222-1',
      subtotalMinor: '100000',
      taxAmountMinor: '19000',
      totalAmountMinor: '119000',
      currency: 'COP',
      dueDate: '2026-12-31',
    });

    const invoicesA = await service.getInvoices(tenantA);
    const invoicesB = await service.getInvoices(tenantB);

    expect(invoicesA).toHaveLength(1);
    expect(invoicesB).toHaveLength(0);
  });
});
