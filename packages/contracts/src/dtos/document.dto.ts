import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { DocumentStatus } from '../enums';
import type { WithContext } from './context.dto';

/** MIME types aceptados para la subida de documentos (PDF e imágenes). */
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export type AllowedDocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/** Tamaño máximo de subida: 10 MiB. */
export const MAX_DOCUMENT_SIZE_BYTES = 10485760;

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @IsIn(ALLOWED_DOCUMENT_MIME_TYPES)
  mimeType!: AllowedDocumentMimeType;

  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_SIZE_BYTES)
  sizeBytes!: number;
}

export interface DocumentLineItem {
  description: string;
  quantity: number;
  unitPriceMinor: string;
  taxRateBps: number;
  totalMinor: string;
}

export interface DocumentResponse {
  id: string;
  tenantId: string;
  status: DocumentStatus;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  provider: string | null;
  taxId: string | null;
  issueDate: string | null;
  currency: string | null;
  totalMinor: string | null;
  confidence: number | null;
  invoiceNumber: string | null;
  requiresReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export class SearchDocumentsQuery {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number;
}

export interface DocumentSearchResult {
  document: DocumentResponse;
  score: number;
}

export type DocumentUploadRpcPayload = WithContext<
  CreateDocumentDto & { checksumSha256: string; storageKey: string }
>;

export type DocumentSearchRpcPayload = WithContext<SearchDocumentsQuery>;

export type GetDocumentRpcPayload = WithContext<{ documentId: string }>;

export interface DocumentOcrJobData {
  documentId: string;
  tenantId: string;
  userId: string;
  storageKey: string;
  mimeType: string;
}
