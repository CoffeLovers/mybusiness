import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentDegradationReason, ContextType } from '../enums';
import type { McpToolName } from '../mcp/mcp.dto';
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

// ==========================================
// Gobernanza de Tokens (SF3-03)
// ==========================================

export class GetAgentBudgetDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodKey must be in YYYY-MM format' })
  periodKey?: string;
}

export class GetAgentUsageDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodKey must be in YYYY-MM format' })
  periodKey?: string;
}

export class ReserveTokenBudgetDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsInt()
  @Min(0)
  estimatedCostMicroUsd!: number;
}

export class SettleTokenBudgetDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsInt()
  @Min(0)
  actualCostMicroUsd!: number;

  @IsInt()
  @Min(0)
  promptTokens!: number;

  @IsInt()
  @Min(0)
  completionTokens!: number;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsBoolean()
  @IsOptional()
  cacheHit?: boolean;

  @IsBoolean()
  @IsOptional()
  degraded?: boolean;
}

export class ReleaseTokenBudgetDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;
}

export interface AgentBudgetSnapshot {
  tenantId: string;
  periodKey: string;
  limitMicroUsd: number;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  availableMicroUsd: number;
  warnRatio: number;
  hardLimit: boolean;
  isExhausted: boolean;
  isWarning: boolean;
}

export interface AgentUsageSummary {
  tenantId: string;
  periodKey: string;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostMicroUsd: number;
  cacheHits: number;
  cacheHitRate: number;
  degradedRequests: number;
}

export interface AgentBudgetExhaustedEvent {
  tenantId: string;
  periodKey: string;
  limitMicroUsd: number;
  spentMicroUsd: number;
  occurredAt: string;
}

export interface AgentChatConsumption {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  cacheHit: boolean;
  degraded: boolean;
  remainingMicroUsd: number;
}

export interface AgentDegradedResponse {
  degraded: true;
  reason: AgentDegradationReason;
  message: string;
  suggestions: string[];
}

export interface ReserveTokenBudgetResult {
  granted: boolean;
  correlationId: string;
  reservedMicroUsd: number;
  remainingMicroUsd: number;
  reason?: string;
}

export interface SettleTokenBudgetResult {
  success: boolean;
  correlationId: string;
  actualCostMicroUsd: number;
  remainingMicroUsd: number;
  /** `true` cuando la reserva quedó liquidada (incluidos los reintentos idempotentes). */
  settled?: boolean;
  /** `true` cuando la reserva ya estaba liquidada y este reintento no volvió a imputar consumo. */
  alreadySettled?: boolean;
  consumption: AgentChatConsumption;
}

export interface ReleaseTokenBudgetResult {
  success: boolean;
  correlationId: string;
  releasedMicroUsd: number;
  remainingMicroUsd: number;
}

// ==========================================
// Asistente conversacional determinista (SF3-02)
// ==========================================

/**
 * Entrada del chat conversacional.
 *
 * El contexto (`tenantId`, `userId`, `role`) NUNCA forma parte del DTO:
 * se resuelve exclusivamente del contexto RPC seguro.
 */
export class AgentChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  conversationId?: string;
}

/**
 * Referencia explícita de la evidencia usada para construir la respuesta.
 */
export class AgentChatCitation {
  @IsIn(['tool', 'memory'])
  source!: 'tool' | 'memory';

  @IsString()
  @IsNotEmpty()
  ref!: string;

  @IsOptional()
  @IsString()
  tool?: McpToolName;

  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsString()
  label?: string;
}

/**
 * Consumo y presupuesto restante de una interacción de chat.
 */
export class AgentChatUsageDto {
  @IsInt()
  @Min(0)
  promptTokens!: number;

  @IsInt()
  @Min(0)
  completionTokens!: number;

  @IsInt()
  @Min(0)
  costMicroUsd!: number;

  @IsInt()
  @Min(0)
  budgetRemainingMicroUsd!: number;

  @IsBoolean()
  cacheHit!: boolean;
}

/**
 * Respuesta del asistente conversacional.
 *
 * `degraded` indica que la respuesta se construyó sin un LLM confiable
 * (modo degradado por presupuesto, error del proveedor o grounding fallido).
 */
export class AgentChatResponseDto {
  @IsString()
  answer!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentChatCitation)
  citations!: AgentChatCitation[];

  @IsBoolean()
  degraded!: boolean;

  @IsOptional()
  @IsEnum(AgentDegradationReason)
  reason?: AgentDegradationReason;

  @IsOptional()
  @IsString()
  code?: string;

  @ValidateNested()
  @Type(() => AgentChatUsageDto)
  usage!: AgentChatUsageDto;
}

export type AgentChatRpcPayload = WithContext<AgentChatDto>;

// ==========================================
// Streaming del Asistente SSE (SF4-01)
// ==========================================

export type AgentStreamEventType = 'token' | 'tool' | 'citation' | 'done' | 'error';

export interface AgentStreamTokenEvent {
  id: string;
  type: 'token';
  delta: string;
}

export interface AgentStreamToolEvent {
  id: string;
  type: 'tool';
  tool: string;
  status: 'start' | 'complete';
  period?: string;
}

export interface AgentStreamCitationEvent {
  id: string;
  type: 'citation';
  citation: AgentChatCitation;
}

export interface AgentStreamDoneEvent {
  id: string;
  type: 'done';
  usage: AgentChatUsageDto;
  degraded: boolean;
  reason?: AgentDegradationReason;
}

export interface AgentStreamErrorEvent {
  id: string;
  type: 'error';
  code: string;
  message: string;
}

export type AgentStreamEvent =
  | AgentStreamTokenEvent
  | AgentStreamToolEvent
  | AgentStreamCitationEvent
  | AgentStreamDoneEvent
  | AgentStreamErrorEvent;

export type GetAgentBudgetRpcPayload = WithContext<GetAgentBudgetDto>;
export type GetAgentUsageRpcPayload = WithContext<GetAgentUsageDto>;
export type ReserveTokenBudgetRpcPayload = WithContext<ReserveTokenBudgetDto>;
export type SettleTokenBudgetRpcPayload = WithContext<SettleTokenBudgetDto>;
export type ReleaseTokenBudgetRpcPayload = WithContext<ReleaseTokenBudgetDto>;
