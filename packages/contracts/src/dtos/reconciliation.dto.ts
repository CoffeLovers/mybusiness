import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { WithContext } from './context.dto';

export enum ReconciliationMatchStatus {
  AUTO_MATCHED = 'AUTO_MATCHED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  MANUAL_MATCHED = 'MANUAL_MATCHED',
  REJECTED = 'REJECTED',
}

export enum ReconciliationRunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ReconciliationTrigger {
  MANUAL = 'MANUAL',
  NIGHTLY = 'NIGHTLY',
}

export class UpdateReconciliationSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  dateWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(10000)
  autoMatchThresholdBps?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  lookbackDays?: number;

  @IsOptional()
  @IsBoolean()
  nightlyEnabled?: boolean;
}

export interface ReconciliationSettingsResponse {
  tenantId: string;
  dateWindowDays: number;
  autoMatchThresholdBps: number;
  timezone: string;
  lookbackDays: number;
  nightlyEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationEvidence {
  amountMinor: string;
  currency: string;
  dateDeltaDays: number;
  counterpartySimilarity: number;
  invoiceNumberMatch: boolean;
  score: number;
  rule: string;
  bankTransactionDate?: string;
  documentIssueDate?: string | null;
  bankTransactionName?: string;
  documentProviderName?: string | null;
  documentInvoiceNumber?: string | null;
}

export interface ReconciliationReviewItemResponse {
  id: string;
  tenantId: string;
  bankTransactionId: string;
  documentId: string;
  invoiceId: string | null;
  status: ReconciliationMatchStatus;
  score: number;
  rule: string;
  evidence: ReconciliationEvidence;
  matchedBy: string | null;
  matchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bankTransaction?: {
    id: string;
    amountMinor: string;
    isoCurrencyCode: string;
    date: string;
    name: string;
    merchantName: string | null;
  };
  document?: {
    id: string;
    originalName: string;
    providerName: string | null;
    taxId: string | null;
    issueDate: string | null;
    currency: string | null;
    totalMinor: string | null;
    confidence: number | null;
    invoiceNumber: string | null;
    status: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalAmountMinor: string;
    currency: string;
    status: string;
  } | null;
}

export class ManualReconciliationDto {
  @IsUUID()
  @IsNotEmpty()
  bankTransactionId!: string;

  @IsUUID()
  @IsNotEmpty()
  documentId!: string;
}

export class ListReconciliationReviewQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReconciliationMetricsQuery {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class RunReconciliationDto {
  @IsOptional()
  @IsEnum(ReconciliationTrigger)
  trigger?: ReconciliationTrigger;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export interface ReconciliationRunResponse {
  id: string;
  tenantId: string;
  trigger: ReconciliationTrigger;
  status: ReconciliationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  processed: number;
  autoMatched: number;
  needsReview: number;
  errors: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface ReconciliationMetricsResponse {
  hasData: boolean;
  autoMatchRate: number | null;
  reviewRate: number | null;
  totalProcessed: number;
  totalAutoMatched: number;
  totalNeedsReview: number;
  totalManualMatched: number;
  totalRejected: number;
  totalErrors: number;
  totalRuns: number;
  runs?: ReconciliationRunResponse[];
  from?: string | null;
  to?: string | null;
}

export interface ReconciliationJobData {
  tenantId: string;
  trigger: ReconciliationTrigger | 'MANUAL' | 'NIGHTLY';
  from?: string;
  to?: string;
}

export type GetReconciliationSettingsPayload = WithContext<Record<string, never>>;
export type UpdateReconciliationSettingsPayload = WithContext<UpdateReconciliationSettingsDto>;
export type RunReconciliationPayload = WithContext<RunReconciliationDto>;
export type ListReconciliationReviewPayload = WithContext<ListReconciliationReviewQuery>;
export type ConfirmReconciliationReviewPayload = WithContext<{ matchId: string }>;
export type RejectReconciliationReviewPayload = WithContext<{ matchId: string }>;
export type ManualReconciliationPayload = WithContext<ManualReconciliationDto>;
export type GetReconciliationMetricsPayload = WithContext<ReconciliationMetricsQuery>;
