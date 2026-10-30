import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  AccountType,
  FinanceEvents,
  InvoiceStatus,
  TransactionStatus,
  TransactionType,
  UserRole,
  type RequestContext,
} from '@mybusiness/contracts';
import { FinanceService } from '../src/finance.service';
import { DuplicateInvoiceNumberError, FinanceRepository } from '../src/finance.repository';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { DomainEventPublisher } from '../src/events/domain-event.publisher';
import type { BankAccount, Invoice, Transaction } from '../src/database/schema';

const tenantA: RequestContext = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  role: UserRole.ACCOUNTANT,
};

const accountId = '22222222-2222-4222-8222-222222222222';
const transactionId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';

function accountRow(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: accountId,
    tenantId: tenantA.tenantId,
    institutionName: 'Banco Test',
    institutionCode: null,
    accountType: AccountType.CHECKING,
    accountNumberMasked: '****1234',
    currency: 'COP',
    currentBalanceMinor: 123456789n,
    availableBalanceMinor: 123456789n,
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
    tenantId: tenantA.tenantId,
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
    tenantId: tenantA.tenantId,
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

function accountDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    institutionName: 'Banco Test',
    accountType: AccountType.CHECKING,
    accountNumberMasked: '****1234',
    currency: 'COP',
    ...overrides,
  };
}

function transactionDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    bankAccountId: accountId,
    amountMinor: '150000',
    currency: 'COP',
    type: TransactionType.EXPENSE,
    description: 'Gasto de prueba',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

function invoiceDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    invoiceNumber: 'INV-001',
    counterpartyName: 'Cliente Test',
    counterpartyTaxId: '900123456',
    subtotalMinor: '100000',
    taxAmountMinor: '19000',
    totalAmountMinor: '119000',
    currency: 'COP',
    dueDate: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function createFailingInsertDatabase(error: unknown) {
  return {
    db: {
      insert: () => ({
        values: () => ({
          returning: () => Promise.reject(error),
        }),
      }),
    },
  } as unknown as FinanceDatabaseService;
}

function createRepositoryMock() {
  return {
    listAccounts: vi.fn(),
    findAccountById: vi.fn(),
    createAccount: vi.fn(),
    listTransactions: vi.fn(),
    createTransactionIdempotent: vi.fn(),
    listInvoices: vi.fn(),
    createInvoice: vi.fn(),
    findInvoiceById: vi.fn(),
    markInvoicePaid: vi.fn(),
    findTransactionById: vi.fn(),
  } as unknown as FinanceRepository;
}

describe('FinanceService', () => {
  let repository: FinanceRepository;
  let publisher: DomainEventPublisher;
  let service: FinanceService;

  beforeEach(() => {
    repository = createRepositoryMock();
    publisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventPublisher;
    service = new FinanceService(repository, publisher);
  });

  describe('getAccounts', () => {
    it('usa el tenantId del contexto y serializa bigint a string', async () => {
      vi.mocked(repository.listAccounts).mockResolvedValue([accountRow()]);

      const accounts = await service.getAccounts(tenantA);

      expect(repository.listAccounts).toHaveBeenCalledWith(tenantA.tenantId);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].currentBalanceMinor).toBe('123456789');
      expect(accounts[0].availableBalanceMinor).toBe('123456789');
    });
  });

  describe('getTransactions', () => {
    it('mapea filas con bigint a string, fechas ISO y categoría opcional', async () => {
      vi.mocked(repository.listTransactions).mockResolvedValue([
        transactionRow({ amountMinor: 9007199254740993n, category: 'alimentacion' }),
        transactionRow({ id: 'otra', category: null, type: 'INCOME' }),
      ]);

      const transactions = await service.getTransactions(tenantA);

      expect(repository.listTransactions).toHaveBeenCalledWith(tenantA.tenantId);
      expect(transactions[0]).toMatchObject({
        id: transactionId,
        amountMinor: '9007199254740993',
        bookingDate: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-02T00:00:00.000Z',
        status: TransactionStatus.PENDING,
        type: TransactionType.EXPENSE,
        category: 'alimentacion',
      });
      expect(transactions[1].type).toBe(TransactionType.INCOME);
      expect(transactions[1].category).toBeUndefined();
      expect('category' in transactions[1]).toBe(false);
    });
  });

  describe('createAccount', () => {
    it('convierte initialBalanceMinor a bigint y devuelve saldos string', async () => {
      vi.mocked(repository.createAccount).mockResolvedValue(accountRow());

      const account = await service.createAccount(
        tenantA,
        accountDto({ initialBalanceMinor: '250000' }),
      );

      expect(repository.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: tenantA.tenantId, initialBalanceMinor: 250000n }),
      );
      expect(account.currentBalanceMinor).toBe('123456789');
      expect(account.availableBalanceMinor).toBe('123456789');
    });

    it('lanza BadRequestException si initialBalanceMinor no es numérico', async () => {
      await expect(
        service.createAccount(tenantA, accountDto({ initialBalanceMinor: '12a' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createAccount).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si initialBalanceMinor no es string', async () => {
      await expect(
        service.createAccount(tenantA, accountDto({ initialBalanceMinor: 5 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createAccount).not.toHaveBeenCalled();
    });
  });

  describe('createTransaction', () => {
    it('lanza NotFoundException si la cuenta no existe', async () => {
      vi.mocked(repository.findAccountById).mockResolvedValue(null);

      await expect(service.createTransaction(tenantA, transactionDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.createTransactionIdempotent).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la moneda no coincide con la cuenta', async () => {
      vi.mocked(repository.findAccountById).mockResolvedValue(accountRow());

      await expect(
        service.createTransaction(tenantA, transactionDto({ currency: 'USD' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createTransactionIdempotent).not.toHaveBeenCalled();
    });

    it('no publica evento en un reintento idempotente y devuelve la transacción existente', async () => {
      const existing = transactionRow({ idempotencyKey: 'idem-retry' });
      vi.mocked(repository.findAccountById).mockResolvedValue(accountRow());
      vi.mocked(repository.createTransactionIdempotent).mockResolvedValue({
        transaction: existing,
        created: false,
      });

      const result = await service.createTransaction(
        tenantA,
        transactionDto({ idempotencyKey: 'idem-retry' }),
      );

      expect(publisher.publish).not.toHaveBeenCalled();
      expect(result.id).toBe(existing.id);
      expect(result.amountMinor).toBe('150000');
    });

    it('publica TRANSACTION_CREATED cuando la transacción es nueva', async () => {
      const created = transactionRow({ amountMinor: 9007199254740993n });
      vi.mocked(repository.findAccountById).mockResolvedValue(accountRow());
      vi.mocked(repository.createTransactionIdempotent).mockResolvedValue({
        transaction: created,
        created: true,
      });

      await service.createTransaction(tenantA, transactionDto());

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const [pattern, event] = vi.mocked(publisher.publish).mock.calls[0];
      expect(pattern).toBe(FinanceEvents.TRANSACTION_CREATED);
      expect(event).toMatchObject({
        transactionId: created.id,
        amountMinor: '9007199254740993',
        currency: 'COP',
        type: TransactionType.EXPENSE,
      });
      expect(typeof (event as { eventId?: unknown }).eventId).toBe('string');
    });
  });

  describe('getInvoices', () => {
    it('mapea filas con montos string, dueDate ISO y status', async () => {
      vi.mocked(repository.listInvoices).mockResolvedValue([
        invoiceRow({ status: InvoiceStatus.ISSUED }),
      ]);

      const invoices = await service.getInvoices(tenantA);

      expect(repository.listInvoices).toHaveBeenCalledWith(tenantA.tenantId);
      expect(invoices[0]).toMatchObject({
        subtotalMinor: '100000',
        taxAmountMinor: '19000',
        totalAmountMinor: '119000',
        dueDate: '2026-02-01T00:00:00.000Z',
        status: InvoiceStatus.ISSUED,
      });
    });
  });

  describe('createInvoice', () => {
    it('convierte montos a bigint, dueDate a Date y devuelve la vista', async () => {
      vi.mocked(repository.createInvoice).mockResolvedValue(invoiceRow());

      const invoice = await service.createInvoice(tenantA, invoiceDto());

      expect(repository.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.tenantId,
          subtotalMinor: 100000n,
          taxAmountMinor: 19000n,
          totalAmountMinor: 119000n,
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
        }),
      );
      expect(invoice.totalAmountMinor).toBe('119000');
      expect(invoice.dueDate).toBe('2026-02-01T00:00:00.000Z');
    });

    it('lanza BadRequestException si dueDate no es una fecha válida', async () => {
      await expect(
        service.createInvoice(tenantA, invoiceDto({ dueDate: 'no-es-fecha' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createInvoice).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si subtotal + tax no coincide con total', async () => {
      await expect(
        service.createInvoice(tenantA, invoiceDto({ totalAmountMinor: '120000' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createInvoice).not.toHaveBeenCalled();
    });

    it('traduce DuplicateInvoiceNumberError a ConflictException', async () => {
      vi.mocked(repository.createInvoice).mockRejectedValue(new DuplicateInvoiceNumberError());

      await expect(service.createInvoice(tenantA, invoiceDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('traduce a ConflictException un 23505 anidado en cause (DrizzleQueryError)', async () => {
      const drizzleError = Object.assign(new Error('Failed query'), { cause: { code: '23505' } });
      const realRepository = new FinanceRepository(createFailingInsertDatabase(drizzleError));

      // El mock del repositorio se comporta como el real: rechaza con el objeto envuelto por Drizzle.
      vi.mocked(repository.createInvoice).mockImplementation(
        realRepository.createInvoice.bind(realRepository),
      );

      await expect(service.createInvoice(tenantA, invoiceDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('payInvoice', () => {
    it('sobre una factura ya pagada no publica evento y devuelve la vista', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'PAID' }));

      const result = await service.payInvoice(tenantA, { invoiceId });

      expect(publisher.publish).not.toHaveBeenCalled();
      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(repository.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('sobre ISSUED actualiza y publica INVOICE_PAID', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'ISSUED' }));
      vi.mocked(repository.markInvoicePaid).mockResolvedValue(invoiceRow({ status: 'PAID' }));

      const result = await service.payInvoice(tenantA, { invoiceId });

      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const [pattern, event] = vi.mocked(publisher.publish).mock.calls[0];
      expect(pattern).toBe(FinanceEvents.INVOICE_PAID);
      expect(event).toMatchObject({
        invoiceId,
        invoiceNumber: 'INV-001',
        totalAmountMinor: '119000',
      });
    });

    it('con transactionId publica INVOICE_PAID con associatedTransactionId', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'ISSUED' }));
      vi.mocked(repository.findTransactionById).mockResolvedValue(transactionRow());
      vi.mocked(repository.markInvoicePaid).mockResolvedValue(
        invoiceRow({ status: 'PAID', associatedTransactionId: transactionId }),
      );

      await service.payInvoice(tenantA, { invoiceId, transactionId });

      expect(repository.markInvoicePaid).toHaveBeenCalledWith(
        tenantA.tenantId,
        invoiceId,
        transactionId,
      );
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const [pattern, event] = vi.mocked(publisher.publish).mock.calls[0];
      expect(pattern).toBe(FinanceEvents.INVOICE_PAID);
      expect(event).toMatchObject({ invoiceId, transactionId });
    });

    it('sin transactionId no incluye transactionId en el payload', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'ISSUED' }));
      vi.mocked(repository.markInvoicePaid).mockResolvedValue(invoiceRow({ status: 'PAID' }));

      await service.payInvoice(tenantA, { invoiceId });

      expect(repository.findTransactionById).not.toHaveBeenCalled();
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      const [, event] = vi.mocked(publisher.publish).mock.calls[0];
      expect('transactionId' in (event as Record<string, unknown>)).toBe(false);
    });

    it('lanza NotFoundException si la factura no existe', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(null);

      await expect(service.payInvoice(tenantA, { invoiceId })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.markInvoicePaid).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('dos pagos concurrentes sólo publican un evento', async () => {
      const issued = invoiceRow({ status: 'ISSUED' });
      const paid = invoiceRow({ status: 'PAID' });
      vi.mocked(repository.findInvoiceById)
        .mockResolvedValueOnce(issued)
        .mockResolvedValueOnce(issued)
        .mockResolvedValue(paid);
      vi.mocked(repository.markInvoicePaid).mockResolvedValueOnce(paid).mockResolvedValueOnce(null);

      const [first, second] = await Promise.all([
        service.payInvoice(tenantA, { invoiceId }),
        service.payInvoice(tenantA, { invoiceId }),
      ]);

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith(FinanceEvents.INVOICE_PAID, expect.anything());
      expect(first.status).toBe(InvoiceStatus.PAID);
      expect(second.status).toBe(InvoiceStatus.PAID);
    });

    it('lanza ConflictException si la factura está CANCELLED', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'CANCELLED' }));

      await expect(service.payInvoice(tenantA, { invoiceId })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si la transacción no pertenece al tenant', async () => {
      vi.mocked(repository.findInvoiceById).mockResolvedValue(invoiceRow({ status: 'ISSUED' }));
      vi.mocked(repository.findTransactionById).mockResolvedValue(null);

      await expect(
        service.payInvoice(tenantA, { invoiceId, transactionId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.markInvoicePaid).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento multi-tenant', () => {
    it('el tenantId del contexto prevalece sobre cualquier tenant del DTO', async () => {
      vi.mocked(repository.findAccountById).mockResolvedValue(accountRow());
      vi.mocked(repository.createTransactionIdempotent).mockResolvedValue({
        transaction: transactionRow(),
        created: true,
      });

      const dto = { ...transactionDto(), tenantId: 'tenant-b' };
      await service.createTransaction(tenantA, dto);

      expect(repository.findAccountById).toHaveBeenCalledWith(tenantA.tenantId, accountId);
      expect(repository.createTransactionIdempotent).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: tenantA.tenantId }),
      );
      expect(repository.findAccountById).not.toHaveBeenCalledWith('tenant-b', expect.anything());
    });
  });
});
