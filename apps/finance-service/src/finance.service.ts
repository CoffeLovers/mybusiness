import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountType,
  FinanceEvents,
  InvoiceStatus,
  TransactionStatus,
  TransactionType,
  type CreateBankAccountDto,
  type CreateInvoiceDto,
  type CreateTransactionDto,
  type InvoicePaidEvent,
  type PayInvoiceDto,
  type RequestContext,
  type TransactionCreatedEvent,
} from '@mybusiness/contracts';
import type { BankAccount, Invoice, Transaction } from './database/schema';
import { DomainEventPublisher } from './events/domain-event.publisher';
import { DuplicateInvoiceNumberError, FinanceRepository } from './finance.repository';

export interface AccountView {
  id: string;
  tenantId: string;
  institutionName: string;
  accountType: AccountType;
  accountNumberMasked: string;
  currency: string;
  currentBalanceMinor: string;
  availableBalanceMinor: string;
  createdAt: string;
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
  createdAt: string;
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly repository: FinanceRepository,
    private readonly events: DomainEventPublisher,
  ) {}

  async getAccounts(ctx: RequestContext): Promise<AccountView[]> {
    const tenantId = this.requireTenant(ctx);
    const accounts = await this.repository.listAccounts(tenantId);
    return accounts.map((account) => this.toAccountView(account));
  }

  async createAccount(ctx: RequestContext, dto: CreateBankAccountDto): Promise<AccountView> {
    const tenantId = this.requireTenant(ctx);
    const initialBalanceMinor = this.parseMinor(
      dto.initialBalanceMinor ?? '0',
      'initialBalanceMinor',
    );

    const account = await this.repository.createAccount({
      tenantId,
      institutionName: dto.institutionName,
      accountType: dto.accountType,
      accountNumberMasked: dto.accountNumberMasked,
      currency: dto.currency,
      initialBalanceMinor,
    });

    return this.toAccountView(account);
  }

  async getTransactions(ctx: RequestContext): Promise<TransactionView[]> {
    const tenantId = this.requireTenant(ctx);
    const transactions = await this.repository.listTransactions(tenantId);
    return transactions.map((transaction) => this.toTransactionView(transaction));
  }

  async createTransaction(
    ctx: RequestContext,
    dto: CreateTransactionDto,
  ): Promise<TransactionView> {
    const tenantId = this.requireTenant(ctx);
    const idempotencyKey = dto?.idempotencyKey;

    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('idempotencyKey es requerido para crear transacciones.');
    }

    const account = await this.repository.findAccountById(tenantId, dto.bankAccountId);
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada para el tenant.');
    }

    if (account.currency !== dto.currency) {
      throw new BadRequestException('La moneda de la transacción no coincide con la de la cuenta.');
    }

    const result = await this.repository.createTransactionIdempotent({
      tenantId,
      bankAccountId: dto.bankAccountId,
      amountMinor: this.parseMinor(dto.amountMinor, 'amountMinor'),
      currency: dto.currency,
      type: dto.type,
      description: dto.description,
      ...(dto.category ? { category: dto.category } : {}),
      idempotencyKey,
    });

    if (result.created) {
      const event: TransactionCreatedEvent = {
        eventId: randomUUID(),
        tenantId,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        transactionId: result.transaction.id,
        bankAccountId: result.transaction.bankAccountId,
        amountMinor: result.transaction.amountMinor.toString(),
        currency: result.transaction.currency,
        type: result.transaction.type as TransactionType,
        occurredAt: result.transaction.createdAt.toISOString(),
      };
      await this.events.publish(FinanceEvents.TRANSACTION_CREATED, event);
    }

    return this.toTransactionView(result.transaction);
  }

  async getInvoices(ctx: RequestContext): Promise<InvoiceView[]> {
    const tenantId = this.requireTenant(ctx);
    const invoices = await this.repository.listInvoices(tenantId);
    return invoices.map((invoice) => this.toInvoiceView(invoice));
  }

  async createInvoice(ctx: RequestContext, dto: CreateInvoiceDto): Promise<InvoiceView> {
    const tenantId = this.requireTenant(ctx);
    const subtotalMinor = this.parseMinor(dto.subtotalMinor, 'subtotalMinor');
    const taxAmountMinor = this.parseMinor(dto.taxAmountMinor, 'taxAmountMinor');
    const totalAmountMinor = this.parseMinor(dto.totalAmountMinor, 'totalAmountMinor');

    if (subtotalMinor + taxAmountMinor !== totalAmountMinor) {
      throw new BadRequestException('El total de la factura debe ser subtotal + impuestos.');
    }

    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('dueDate debe ser una fecha válida.');
    }

    try {
      const invoice = await this.repository.createInvoice({
        tenantId,
        invoiceNumber: dto.invoiceNumber,
        counterpartyName: dto.counterpartyName,
        counterpartyTaxId: dto.counterpartyTaxId,
        subtotalMinor,
        taxAmountMinor,
        totalAmountMinor,
        currency: dto.currency,
        dueDate,
      });
      return this.toInvoiceView(invoice);
    } catch (error) {
      if (error instanceof DuplicateInvoiceNumberError) {
        throw new ConflictException('Ya existe una factura con ese número para el tenant.');
      }
      throw error;
    }
  }

  async payInvoice(ctx: RequestContext, dto: PayInvoiceDto): Promise<InvoiceView> {
    const tenantId = this.requireTenant(ctx);
    const invoice = await this.repository.findInvoiceById(tenantId, dto.invoiceId);

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada para el tenant.');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return this.toInvoiceView(invoice);
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('No se puede pagar una factura cancelada.');
    }

    if (dto.transactionId) {
      const transaction = await this.repository.findTransactionById(tenantId, dto.transactionId);
      if (!transaction) {
        throw new NotFoundException('Transacción no encontrada para el tenant.');
      }
    }

    const updated = await this.repository.markInvoicePaid(
      tenantId,
      dto.invoiceId,
      dto.transactionId,
    );

    if (!updated) {
      const current = await this.repository.findInvoiceById(tenantId, dto.invoiceId);
      if (current?.status === InvoiceStatus.PAID) {
        return this.toInvoiceView(current);
      }
      if (current?.status === InvoiceStatus.CANCELLED) {
        throw new ConflictException('No se puede pagar una factura cancelada.');
      }
      throw new NotFoundException('Factura no encontrada para el tenant.');
    }

    const event: InvoicePaidEvent = {
      eventId: randomUUID(),
      tenantId,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      totalAmountMinor: updated.totalAmountMinor.toString(),
      currency: updated.currency,
      ...(updated.associatedTransactionId
        ? { transactionId: updated.associatedTransactionId }
        : {}),
      occurredAt: new Date().toISOString(),
    };
    await this.events.publish(FinanceEvents.INVOICE_PAID, event);

    return this.toInvoiceView(updated);
  }

  private requireTenant(ctx: RequestContext): string {
    if (!ctx?.tenantId) {
      throw new BadRequestException('tenantId es requerido en el contexto RPC.');
    }
    return ctx.tenantId;
  }

  private parseMinor(value: string, field: string): bigint {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new BadRequestException(`${field} debe ser un entero no negativo en unidades menores.`);
    }
    return BigInt(value);
  }

  private toAccountView(account: BankAccount): AccountView {
    return {
      id: account.id,
      tenantId: account.tenantId,
      institutionName: account.institutionName,
      accountType: account.accountType as AccountType,
      accountNumberMasked: account.accountNumberMasked,
      currency: account.currency,
      currentBalanceMinor: account.currentBalanceMinor.toString(),
      availableBalanceMinor: account.availableBalanceMinor.toString(),
      createdAt: account.createdAt.toISOString(),
    };
  }

  private toTransactionView(transaction: Transaction): TransactionView {
    return {
      id: transaction.id,
      tenantId: transaction.tenantId,
      bankAccountId: transaction.bankAccountId,
      amountMinor: transaction.amountMinor.toString(),
      currency: transaction.currency,
      type: transaction.type as TransactionType,
      status: transaction.status as TransactionStatus,
      description: transaction.description,
      ...(transaction.category ? { category: transaction.category } : {}),
      idempotencyKey: transaction.idempotencyKey,
      bookingDate: transaction.bookingDate.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
    };
  }

  private toInvoiceView(invoice: Invoice): InvoiceView {
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      invoiceNumber: invoice.invoiceNumber,
      counterpartyName: invoice.counterpartyName,
      counterpartyTaxId: invoice.counterpartyTaxId,
      subtotalMinor: invoice.subtotalMinor.toString(),
      taxAmountMinor: invoice.taxAmountMinor.toString(),
      totalAmountMinor: invoice.totalAmountMinor.toString(),
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status as InvoiceStatus,
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
