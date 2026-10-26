import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AccountType, TransactionType } from '../enums';

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
  currency!: string;

  @IsNumber()
  @IsOptional()
  initialBalance?: number;
}

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
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
  @IsOptional()
  idempotencyKey?: string;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsString()
  @IsNotEmpty()
  counterpartyName!: string;

  @IsString()
  counterpartyTaxId!: string;

  @IsNumber()
  subtotal!: number;

  @IsNumber()
  taxAmount!: number;

  @IsNumber()
  totalAmount!: number;

  @IsString()
  currency!: string;

  @IsString()
  dueDate!: string;
}
