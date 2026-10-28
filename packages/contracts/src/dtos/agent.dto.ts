import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ContextType } from '../enums';
import type { RequestContext, WithContext } from './context.dto';

export class StoreAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(ContextType)
  contextType!: ContextType;

  @IsArray()
  @IsOptional()
  embedding?: number[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class QueryAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  queryText!: string;

  @IsArray()
  @IsOptional()
  queryEmbedding?: number[];

  @IsNumber()
  @IsOptional()
  topK?: number;
}

/** Payloads RPC de Agent: siempre incluyen tenantId, userId y role. */
export type AgentTenantPayload = RequestContext;
export type StoreAgentMemoryRpcPayload = WithContext<StoreAgentMemoryDto>;
export type QueryAgentMemoryRpcPayload = WithContext<QueryAgentMemoryDto>;
