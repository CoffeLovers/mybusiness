import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AccountType, TransactionType } from '../enums';
import { CURRENCY_CODE_PATTERN, MAX_MONEY_MINOR_DIGITS, MONEY_MINOR_PATTERN } from '../money';
import type { RequestContext, WithContext } from './context.dto';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  institutionName!: string;

  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsString()
  @IsNotEmpty()
  accountNumberMasked!: string;

  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  currency!: string;

  @IsString()
  @IsOptional()
  @Matches(MONEY_MINOR_PATTERN)
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  initialBalanceMinor?: string;
}

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(MONEY_MINOR_PATTERN)
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  amountMinor!: string;

  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  currency!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsString()
  @IsNotEmpty()
  counterpartyName!: string;

  @IsString()
  @IsNotEmpty()
  counterpartyTaxId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(MONEY_MINOR_PATTERN)
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  subtotalMinor!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(MONEY_MINOR_PATTERN)
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  taxAmountMinor!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(MONEY_MINOR_PATTERN)
  @MaxLength(MAX_MONEY_MINOR_DIGITS)
  totalAmountMinor!: string;

  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  currency!: string;

  @IsString()
  @IsNotEmpty()
  dueDate!: string;
}

/** Payloads RPC de Finance: siempre incluyen tenantId, userId y role. */
export type FinanceTenantPayload = RequestContext;
export type CreateBankAccountRpcPayload = WithContext<CreateBankAccountDto>;
export type CreateTransactionRpcPayload = WithContext<CreateTransactionDto>;
export type CreateInvoiceRpcPayload = WithContext<CreateInvoiceDto>;

export class PayInvoiceDto {
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;

  @IsString()
  @IsOptional()
  transactionId?: string;
}

export type PayInvoiceRpcPayload = WithContext<PayInvoiceDto>;

/** Evento: se creó una transacción (incluye reintentos idempotentes sólo la primera vez). */
export interface TransactionCreatedEvent {
  eventId: string;
  tenantId: string;
  userId?: string;
  transactionId: string;
  bankAccountId: string;
  amountMinor: string;
  currency: string;
  type: TransactionType;
  occurredAt: string;
}

/** Evento: una factura pasó a estado PAID. */
export interface InvoicePaidEvent {
  eventId: string;
  tenantId: string;
  userId?: string;
  invoiceId: string;
  invoiceNumber: string;
  totalAmountMinor: string;
  currency: string;
  transactionId?: string;
  occurredAt: string;
}
