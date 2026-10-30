import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ContextType } from '../enums';
import type { RequestContext, WithContext } from './context.dto';

export class StoreAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(ContextType)
  @IsOptional()
  contextType?: ContextType;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class QueryAgentMemoryDto {
  @IsString()
  @IsOptional()
  queryText?: string;

  @IsString()
  @IsOptional()
  query?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  topK?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  threshold?: number;

  @IsEnum(ContextType)
  @IsOptional()
  contextType?: ContextType;
}

export class SearchAgentMemoryDto extends QueryAgentMemoryDto {}

export class DeleteAgentMemoryDto {
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
