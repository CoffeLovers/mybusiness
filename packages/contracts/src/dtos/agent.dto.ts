import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ContextType } from '../enums';
import type { RequestContext, WithContext } from './context.dto';

export class StoreAgentMemoryDto {
  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(ContextType)
  @IsOptional()
  contextType?: ContextType;

  @IsArray()
  @IsOptional()
  embedding?: number[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class QueryAgentMemoryDto {
  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  queryText?: string;

  @IsString()
  @IsOptional()
  query?: string;

  @IsArray()
  @IsOptional()
  queryEmbedding?: number[];

  @IsNumber()
  @IsOptional()
  topK?: number;

  @IsNumber()
  @IsOptional()
  threshold?: number;

  @IsEnum(ContextType)
  @IsOptional()
  contextType?: ContextType;
}

export class SearchAgentMemoryDto extends QueryAgentMemoryDto {}

export class DeleteAgentMemoryDto {
  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

export interface AgentMemoryItem {
  id: string;
  tenantId: string;
  userId?: string | null;
  content: string;
  contextType: ContextType | string;
  metadata?: Record<string, unknown>;
  createdAt: string | Date;
  similarityScore?: number;
  distance?: number;
}

export interface StoreAgentMemoryResponse {
  id: string;
  tenantId: string;
  userId?: string | null;
  content: string;
  contextType: ContextType | string;
  metadata?: Record<string, unknown>;
  createdAt: string | Date;
  embeddingDimensions: number;
}

export interface SearchAgentMemoryResult {
  id: string;
  content: string;
  contextType?: string;
  similarityScore: number;
  distance?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string | Date;
}

export interface SearchAgentMemoryResponse {
  query: string;
  results: SearchAgentMemoryResult[];
}

export type QueryAgentMemoryResponse = SearchAgentMemoryResponse;

/** Payloads RPC de Agent: siempre incluyen tenantId, userId y role. */
export type AgentTenantPayload = RequestContext;
export type StoreAgentMemoryRpcPayload = WithContext<StoreAgentMemoryDto>;
export type QueryAgentMemoryRpcPayload = WithContext<QueryAgentMemoryDto>;
export type SearchAgentMemoryRpcPayload = WithContext<SearchAgentMemoryDto>;
export type DeleteAgentMemoryRpcPayload = WithContext<DeleteAgentMemoryDto>;
