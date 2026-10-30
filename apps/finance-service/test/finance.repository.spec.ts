import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountType, InvoiceStatus, TransactionStatus } from '@mybusiness/contracts';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { BankAccount, Invoice, Transaction } from '../src/database/schema';
import { DuplicateInvoiceNumberError, FinanceRepository } from '../src/finance.repository';

const tenantId = 'tenant-a';
const accountId = '22222222-2222-4222-8222-222222222222';
const transactionId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';

function accountRow(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: accountId,
    tenantId,
    institutionName: 'Banco Test',
    institutionCode: null,
    accountType: AccountType.CHECKING,
    accountNumberMasked: '****1234',
    currency: 'COP',
    currentBalanceMinor: 5000n,
    availableBalanceMinor: 5000n,
    syncStatus: 'SYNCED',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function transactionRow(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: transactionId,
    tenantId,
    bankAccountId: accountId,
    amountMinor: 150000n,
    currency: 'COP',
    type: 'EXPENSE',
    status: TransactionStatus.PENDING,
    bookingDate: new Date('2026-01-02T00:00:00.000Z'),
    description: 'Gasto de prueba',
    category: null,
    counterparty: {},
    idempotencyKey: 'idem-1',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: invoiceId,
    tenantId,
    invoiceNumber: 'INV-001',
    counterpartyName: 'Cliente Test',
    counterpartyTaxId: '900123456',
    issueDate: new Date('2026-01-01T00:00:00.000Z'),
    dueDate: new Date('2026-02-01T00:00:00.000Z'),
    subtotalMinor: 100000n,
    taxAmountMinor: 19000n,
    totalAmountMinor: 119000n,
    currency: 'COP',
    status: 'ISSUED',
    lineItems: [],
    associatedTransactionId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Mock encadenable de Drizzle: los métodos de construcción devuelven el propio
 * builder y `limit`/`returning` resuelven los resultados configurados por test.
 */
function createQueryBuilder() {
  const db: Record<string, unknown> = {};
  const passthrough = () => vi.fn<(...args: unknown[]) => Record<string, unknown>>(() => db);
  const limit = vi.fn<(value?: number) => Promise<unknown[]>>();
  const returning = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

  const select = passthrough();
  const from = passthrough();
  const where = passthrough();
  const orderBy = passthrough();
  const insert = passthrough();
  const values = passthrough();
  const onConflictDoNothing = passthrough();
  const update = passthrough();
  const set = passthrough();

  Object.assign(db, {
    select,
    from,
    where,
    orderBy,
    limit,
    insert,
    values,
    onConflictDoNothing,
    returning,
    update,
    set,
  });

  return {
    db,
    select,
    from,
    where,
    orderBy,
    limit,
    insert,
    values,
    onConflictDoNothing,
    returning,
    update,
    set,
  };
}

describe('FinanceRepository', () => {
  let mock: ReturnType<typeof createQueryBuilder>;
  let repository: FinanceRepository;

  beforeEach(() => {
    mock = createQueryBuilder();
    mock.limit.mockResolvedValue([]);
    mock.returning.mockResolvedValue([]);
    repository = new FinanceRepository({ db: mock.db } as unknown as FinanceDatabaseService);
  });

  describe('listAccounts', () => {
    it('devuelve las filas y limita a 200', async () => {
      mock.limit.mockResolvedValueOnce([accountRow()]);

      const accounts = await repository.listAccounts(tenantId);

      expect(accounts).toEqual([accountRow()]);
      expect(mock.select).toHaveBeenCalledTimes(1);
      expect(mock.where).toHaveBeenCalledTimes(1);
      expect(mock.limit).toHaveBeenCalledWith(200);
    });
  });

  describe('listTransactions', () => {
    it('devuelve las filas y limita a 200', async () => {
      mock.limit.mockResolvedValueOnce([transactionRow()]);

      const transactions = await repository.listTransactions(tenantId);

      expect(transactions).toEqual([transactionRow()]);
      expect(mock.limit).toHaveBeenCalledWith(200);
    });
  });

  describe('listInvoices', () => {
    it('devuelve las filas y limita a 200', async () => {
      mock.limit.mockResolvedValueOnce([invoiceRow()]);

      const invoices = await repository.listInvoices(tenantId);

      expect(invoices).toEqual([invoiceRow()]);
      expect(mock.limit).toHaveBeenCalledWith(200);
    });
  });

  describe('findAccountById', () => {
    it('devuelve la cuenta encontrada', async () => {
      mock.limit.mockResolvedValueOnce([accountRow()]);

      await expect(repository.findAccountById(tenantId, accountId)).resolves.toEqual(accountRow());
    });

    it('devuelve null si no hay filas', async () => {
      mock.limit.mockResolvedValueOnce([]);

      await expect(repository.findAccountById(tenantId, accountId)).resolves.toBeNull();
    });
  });

  describe('findTransactionById', () => {
    it('devuelve la transacción encontrada', async () => {
      mock.limit.mockResolvedValueOnce([transactionRow()]);

      await expect(repository.findTransactionById(tenantId, transactionId)).resolves.toEqual(
        transactionRow(),
      );
    });

    it('devuelve null si no hay filas', async () => {
      mock.limit.mockResolvedValueOnce([]);

      await expect(repository.findTransactionById(tenantId, transactionId)).resolves.toBeNull();
    });
  });

  describe('createAccount', () => {
    it('inicializa ambos saldos con el saldo inicial en bigint', async () => {
      mock.returning.mockResolvedValueOnce([accountRow()]);

      const account = await repository.createAccount({
        tenantId,
        institutionName: 'Banco Test',
        accountType: AccountType.CHECKING,
        accountNumberMasked: '****1234',
        currency: 'COP',
        initialBalanceMinor: 5000n,
      });

      expect(account).toEqual(accountRow());
      expect(mock.insert).toHaveBeenCalledTimes(1);
      const inserted = mock.values.mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.currentBalanceMinor).toBe(5000n);
      expect(inserted.availableBalanceMinor).toBe(5000n);
    });
  });

  describe('createTransactionIdempotent', () => {
    const record = {
      tenantId,
      bankAccountId: accountId,
      amountMinor: 150000n,
      currency: 'COP',
      type: 'EXPENSE' as const,
      description: 'Gasto de prueba',
      idempotencyKey: 'idem-1',
    };

    it('devuelve created: true cuando inserta', async () => {
      mock.returning.mockResolvedValueOnce([transactionRow()]);

      const result = await repository.createTransactionIdempotent(record);

      expect(result).toEqual({ transaction: transactionRow(), created: true });
      expect(mock.onConflictDoNothing).toHaveBeenCalledTimes(1);
      expect(mock.select).not.toHaveBeenCalled();
    });

    it('devuelve created: false y la transacción existente cuando hay conflicto', async () => {
      mock.returning.mockResolvedValueOnce([]);
      mock.limit.mockResolvedValueOnce([transactionRow()]);

      const result = await repository.createTransactionIdempotent(record);

      expect(result).toEqual({ transaction: transactionRow(), created: false });
      expect(mock.select).toHaveBeenCalledTimes(1);
    });

    it('lanza si no inserta y tampoco encuentra la transacción', async () => {
      mock.returning.mockResolvedValueOnce([]);
      mock.limit.mockResolvedValueOnce([]);

      await expect(repository.createTransactionIdempotent(record)).rejects.toThrow(
        'No se pudo resolver la transacción idempotente',
      );
    });
  });

  describe('createInvoice', () => {
    const record = {
      tenantId,
      invoiceNumber: 'INV-001',
      counterpartyName: 'Cliente Test',
      counterpartyTaxId: '900123456',
      subtotalMinor: 100000n,
      taxAmountMinor: 19000n,
      totalAmountMinor: 119000n,
      currency: 'COP',
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
    };

    it('devuelve la factura creada', async () => {
      mock.returning.mockResolvedValueOnce([invoiceRow()]);

      await expect(repository.createInvoice(record)).resolves.toEqual(invoiceRow());
    });

    it('traduce el conflicto de número de factura a DuplicateInvoiceNumberError', async () => {
      mock.returning.mockRejectedValueOnce({
        cause: { code: '23505', constraint: 'invoices_tenant_number_uq' },
      });

      await expect(repository.createInvoice(record)).rejects.toBeInstanceOf(
        DuplicateInvoiceNumberError,
      );
    });

    it('relanza un 23505 de otro constraint', async () => {
      const error = { code: '23505', constraint: 'other_uq' };
      mock.returning.mockRejectedValueOnce(error);

      await expect(repository.createInvoice(record)).rejects.toBe(error);
    });

    it('relanza errores no relacionados con la unicidad', async () => {
      const error = new Error('fallo genérico');
      mock.returning.mockRejectedValueOnce(error);

      await expect(repository.createInvoice(record)).rejects.toBe(error);
    });
  });

  describe('findInvoiceById', () => {
    it('devuelve la factura encontrada', async () => {
      mock.limit.mockResolvedValueOnce([invoiceRow()]);

      await expect(repository.findInvoiceById(tenantId, invoiceId)).resolves.toEqual(invoiceRow());
    });

    it('devuelve null si no hay filas', async () => {
      mock.limit.mockResolvedValueOnce([]);

      await expect(repository.findInvoiceById(tenantId, invoiceId)).resolves.toBeNull();
    });
  });

  describe('markInvoicePaid', () => {
    it('devuelve la factura actualizada', async () => {
      const paid = invoiceRow({ status: InvoiceStatus.PAID });
      mock.returning.mockResolvedValueOnce([paid]);

      await expect(repository.markInvoicePaid(tenantId, invoiceId, transactionId)).resolves.toEqual(
        paid,
      );
      expect(mock.update).toHaveBeenCalledTimes(1);
      const updated = mock.set.mock.calls[0][0] as Record<string, unknown>;
      expect(updated.status).toBe('PAID');
      expect(updated.associatedTransactionId).toBe(transactionId);
    });

    it('devuelve null cuando no hay filas actualizadas', async () => {
      mock.returning.mockResolvedValueOnce([]);

      await expect(repository.markInvoicePaid(tenantId, invoiceId)).resolves.toBeNull();
    });
  });
});
