import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { WithContext } from './context.dto';

/** Campos ordenables del libro mayor (whitelist; nunca se interpola SQL del cliente). */
export enum LedgerSortField {
  DATE = 'date',
  AMOUNT = 'amount',
  NAME = 'name',
  CATEGORY = 'category',
  STATUS = 'status',
}

/** Estado de conciliación derivado de `reconciliation_matches`. */
export enum LedgerReconciliationStatus {
  UNMATCHED = 'UNMATCHED',
  AUTO_MATCHED = 'AUTO_MATCHED',
  MANUAL_MATCHED = 'MANUAL_MATCHED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  REJECTED = 'REJECTED',
}

export class LedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsEnum(LedgerSortField)
  sortBy?: LedgerSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsEnum(LedgerReconciliationStatus)
  reconciliationStatus?: LedgerReconciliationStatus;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export interface LedgerEvidence {
  documentId: string;
  documentName: string;
  score: number;
  rule: string;
  matchedAt: string | null;
}

export interface LedgerRowResponse {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  category: string | null;
  notes: string | null;
  amountMinor: string;
  isoCurrencyCode: string;
  accountId: string;
  accountName: string;
  reconciliationStatus: LedgerReconciliationStatus;
  evidence: LedgerEvidence | null;
  updatedAt: string;
}

export interface LedgerPageResponse {
  rows: LedgerRowResponse[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export class UpdateLedgerTransactionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class BulkCategorizeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  category!: string;
}

export class SaveLedgerViewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ValidateNested()
  @Type(() => LedgerQueryDto)
  query!: LedgerQueryDto;
}

export interface SavedLedgerViewResponse {
  id: string;
  name: string;
  query: LedgerQueryDto;
  createdAt: string;
  updatedAt: string;
}

export type LedgerListRpcPayload = WithContext<LedgerQueryDto>;
export type LedgerExportRpcPayload = WithContext<LedgerQueryDto>;
export type LedgerUpdateRpcPayload = WithContext<
  UpdateLedgerTransactionDto & { transactionId: string }
>;
export type LedgerBulkCategorizeRpcPayload = WithContext<BulkCategorizeDto>;
export type LedgerSavedViewsListRpcPayload = WithContext<Record<string, never>>;
export type LedgerSavedViewCreateRpcPayload = WithContext<SaveLedgerViewDto>;
export type LedgerSavedViewDeleteRpcPayload = WithContext<{ viewId: string }>;
