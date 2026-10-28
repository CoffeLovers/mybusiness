import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  InvoiceStatus,
  TransactionStatus,
  TransactionType,
  type RequestContext,
} from '@mybusiness/contracts';

export interface AccountView {
  id: string;
  tenantId: string;
  institutionName: string;
  accountType: AccountType;
  accountNumberMasked: string;
  currency: string;
  currentBalanceMinor: string;
  availableBalanceMinor: string;
  createdBy?: string;
  createdAt?: string;
}

export interface TransactionView {
  id: string;
  tenantId: string;
  bankAccountId: string;
  amountMinor: string;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  category?: string;
  idempotencyKey: string;
  createdBy?: string;
  bookingDate: string;
  createdAt: string;
}

export interface InvoiceView {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  counterpartyName: string;
  counterpartyTaxId: string;
  subtotalMinor: string;
  taxAmountMinor: string;
  totalAmountMinor: string;
  currency: string;
  dueDate: string;
  status: InvoiceStatus;
  createdBy?: string;
  createdAt: string;
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  /** Datos aislados por tenant. En producción estas consultas van a PostgreSQL con `eq(table.tenantId, tenantId)`. */
  private readonly accountsByTenant = new Map<string, AccountView[]>();
  private readonly transactionsByTenant = new Map<string, TransactionView[]>();
  private readonly invoicesByTenant = new Map<string, InvoiceView[]>();
  /** Índice de idempotencia: `${tenantId}:${idempotencyKey}` -> transacción. */
  private readonly transactionsByIdempotencyKey = new Map<string, TransactionView>();

  async getAccounts(ctx: RequestContext): Promise<AccountView[]> {
    const tenantId = this.requireTenant(ctx);
    this.logger.log(`Obteniendo cuentas para tenant: ${tenantId}`);
    return this.tenantAccounts(tenantId).slice();
  }

  async createAccount(ctx: RequestContext, dto: any): Promise<AccountView> {
    const tenantId = this.requireTenant(ctx);
    const account: AccountView = {
      id: 'acc-' + Math.random().toString(36).substring(2, 9),
      tenantId,
      ...dto,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };

    this.tenantAccounts(tenantId).push(account);
    return account;
  }

  async getTransactions(ctx: RequestContext): Promise<TransactionView[]> {
    const tenantId = this.requireTenant(ctx);
    this.logger.log(`Obteniendo transacciones para tenant: ${tenantId}`);
    return this.tenantTransactions(tenantId).slice();
  }

  async createTransaction(ctx: RequestContext, dto: any): Promise<TransactionView> {
    const tenantId = this.requireTenant(ctx);
    const idempotencyKey = dto?.idempotencyKey;

    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new BadRequestException('idempotencyKey es requerido para crear transacciones.');
    }

    const idempotencyIndex = `${tenantId}:${idempotencyKey}`;
    const existing = this.transactionsByIdempotencyKey.get(idempotencyIndex);

    if (existing) {
      this.logger.log(
        `Transacción idempotente reutilizada para tenant ${tenantId} e idempotencyKey ${idempotencyKey}`,
      );
      return existing;
    }

    const now = new Date().toISOString();
    const transaction: TransactionView = {
      id: 'tx-' + Math.random().toString(36).substring(2, 9),
      tenantId,
      ...dto,
      status: TransactionStatus.PENDING,
      createdBy: ctx.userId,
      bookingDate: now,
      createdAt: now,
    };

    this.transactionsByIdempotencyKey.set(idempotencyIndex, transaction);
    this.tenantTransactions(tenantId).push(transaction);

    this.logger.log(`Transacción creada con idempotencyKey: ${idempotencyKey}`);
    return transaction;
  }

  async getInvoices(ctx: RequestContext): Promise<InvoiceView[]> {
    const tenantId = this.requireTenant(ctx);
    this.logger.log(`Obteniendo facturas para tenant: ${tenantId}`);
    return this.tenantInvoices(tenantId).slice();
  }

  async createInvoice(ctx: RequestContext, dto: any): Promise<InvoiceView> {
    const tenantId = this.requireTenant(ctx);
    const invoice: InvoiceView = {
      id: 'inv-' + Math.random().toString(36).substring(2, 9),
      tenantId,
      ...dto,
      status: InvoiceStatus.DRAFT,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };

    this.tenantInvoices(tenantId).push(invoice);
    return invoice;
  }

  private requireTenant(ctx: RequestContext): string {
    if (!ctx?.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }
    return ctx.tenantId;
  }

  private tenantAccounts(tenantId: string): AccountView[] {
    let accounts = this.accountsByTenant.get(tenantId);
    if (!accounts) {
      accounts = [
        {
          id: 'acc-1',
          tenantId,
          institutionName: 'Bancolombia',
          accountType: AccountType.CHECKING,
          accountNumberMasked: '****4589',
          currency: 'COP',
          currentBalanceMinor: '15420000',
          availableBalanceMinor: '15420000',
        },
      ];
      this.accountsByTenant.set(tenantId, accounts);
    }
    return accounts;
  }

  private tenantTransactions(tenantId: string): TransactionView[] {
    let transactions = this.transactionsByTenant.get(tenantId);
    if (!transactions) {
      transactions = [
        {
          id: 'tx-1',
          tenantId,
          bankAccountId: 'acc-1',
          amountMinor: '250000',
          currency: 'COP',
          type: TransactionType.EXPENSE,
          status: TransactionStatus.SETTLED,
          description: 'Servicio Cloud AWS',
          idempotencyKey: 'seed-tx-1',
          bookingDate: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ];
      this.transactionsByTenant.set(tenantId, transactions);
    }
    return transactions;
  }

  private tenantInvoices(tenantId: string): InvoiceView[] {
    let invoices = this.invoicesByTenant.get(tenantId);
    if (!invoices) {
      invoices = [];
      this.invoicesByTenant.set(tenantId, invoices);
    }
    return invoices;
  }
}
