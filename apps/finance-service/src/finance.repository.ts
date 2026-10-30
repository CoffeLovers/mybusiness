import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { FinanceDatabaseService } from './database/database.service';
import {
  bankAccounts,
  invoices,
  transactions,
  type BankAccount,
  type Invoice,
  type NewBankAccount,
  type NewTransaction,
  type Transaction,
} from './database/schema';

export interface CreateAccountRecord {
  tenantId: string;
  institutionName: string;
  accountType: NewBankAccount['accountType'];
  accountNumberMasked: string;
  currency: string;
  initialBalanceMinor: bigint;
}

export interface CreateTransactionRecord {
  tenantId: string;
  bankAccountId: string;
  amountMinor: bigint;
  currency: string;
  type: NewTransaction['type'];
  description: string;
  category?: string;
  idempotencyKey: string;
}

export interface CreateInvoiceRecord {
  tenantId: string;
  invoiceNumber: string;
  counterpartyName: string;
  counterpartyTaxId: string;
  subtotalMinor: bigint;
  taxAmountMinor: bigint;
  totalAmountMinor: bigint;
  currency: string;
  dueDate: Date;
}

export interface CreateTransactionResult {
  transaction: Transaction;
  created: boolean;
}

export class DuplicateInvoiceNumberError extends Error {
  constructor() {
    super('Ya existe una factura con ese número para el tenant.');
    this.name = DuplicateInvoiceNumberError.name;
  }
}

/**
 * Acceso a datos de finance_db. Todas las consultas filtran explícitamente por
 * `tenantId`: el aislamiento multi-tenant no depende del llamador.
 */
@Injectable()
export class FinanceRepository {
  constructor(private readonly database: FinanceDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async listAccounts(tenantId: string): Promise<BankAccount[]> {
    return this.db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.tenantId, tenantId), isNull(bankAccounts.deletedAt)))
      .orderBy(desc(bankAccounts.createdAt))
      .limit(200);
  }

  async findAccountById(tenantId: string, accountId: string): Promise<BankAccount | null> {
    const [account] = await this.db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.tenantId, tenantId),
          eq(bankAccounts.id, accountId),
          isNull(bankAccounts.deletedAt),
        ),
      )
      .limit(1);

    return account ?? null;
  }

  async createAccount(record: CreateAccountRecord): Promise<BankAccount> {
    const [account] = await this.db
      .insert(bankAccounts)
      .values({
        tenantId: record.tenantId,
        institutionName: record.institutionName,
        accountType: record.accountType,
        accountNumberMasked: record.accountNumberMasked,
        currency: record.currency,
        currentBalanceMinor: record.initialBalanceMinor,
        availableBalanceMinor: record.initialBalanceMinor,
      })
      .returning();

    return account;
  }

  async listTransactions(tenantId: string): Promise<Transaction[]> {
    return this.db
      .select()
      .from(transactions)
      .where(eq(transactions.tenantId, tenantId))
      .orderBy(desc(transactions.bookingDate))
      .limit(200);
  }

  async listInvoices(tenantId: string): Promise<Invoice[]> {
    return this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.createdAt))
      .limit(200);
  }

  async createTransactionIdempotent(
    record: CreateTransactionRecord,
  ): Promise<CreateTransactionResult> {
    const [inserted] = await this.db
      .insert(transactions)
      .values({
        tenantId: record.tenantId,
        bankAccountId: record.bankAccountId,
        amountMinor: record.amountMinor,
        currency: record.currency,
        type: record.type,
        description: record.description,
        ...(record.category ? { category: record.category } : {}),
        idempotencyKey: record.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [transactions.tenantId, transactions.idempotencyKey],
      })
      .returning();

    if (inserted) {
      return { transaction: inserted, created: true };
    }

    const [existing] = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, record.tenantId),
          eq(transactions.idempotencyKey, record.idempotencyKey),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error('No se pudo resolver la transacción idempotente');
    }

    return { transaction: existing, created: false };
  }

  async createInvoice(record: CreateInvoiceRecord): Promise<Invoice> {
    try {
      const [invoice] = await this.db
        .insert(invoices)
        .values({
          tenantId: record.tenantId,
          invoiceNumber: record.invoiceNumber,
          counterpartyName: record.counterpartyName,
          counterpartyTaxId: record.counterpartyTaxId,
          subtotalMinor: record.subtotalMinor,
          taxAmountMinor: record.taxAmountMinor,
          totalAmountMinor: record.totalAmountMinor,
          currency: record.currency,
          dueDate: record.dueDate,
        })
        .returning();

      return invoice;
    } catch (error) {
      if (this.isInvoiceNumberConflict(error)) {
        throw new DuplicateInvoiceNumberError();
      }
      throw error;
    }
  }

  async findInvoiceById(tenantId: string, invoiceId: string): Promise<Invoice | null> {
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.id, invoiceId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1);

    return invoice ?? null;
  }

  async markInvoicePaid(
    tenantId: string,
    invoiceId: string,
    transactionId?: string,
  ): Promise<Invoice | null> {
    const [invoice] = await this.db
      .update(invoices)
      .set({
        status: 'PAID',
        ...(transactionId ? { associatedTransactionId: transactionId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.id, invoiceId),
          isNull(invoices.deletedAt),
          inArray(invoices.status, ['DRAFT', 'ISSUED', 'OVERDUE']),
        ),
      )
      .returning();

    return invoice ?? null;
  }

  async findTransactionById(tenantId: string, transactionId: string): Promise<Transaction | null> {
    const [transaction] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.tenantId, tenantId), eq(transactions.id, transactionId)))
      .limit(1);

    return transaction ?? null;
  }

  private isInvoiceNumberConflict(error: unknown): boolean {
    let current: unknown = error;

    for (let depth = 0; depth < 5; depth += 1) {
      if (typeof current !== 'object' || current === null) {
        return false;
      }

      const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (candidate.code === '23505') {
        return (
          candidate.constraint === undefined || candidate.constraint === 'invoices_tenant_number_uq'
        );
      }

      current = candidate.cause;
    }

    return false;
  }
}
