import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Los valores de este enum se mantienen alineados con `@mybusiness/contracts` (ContextType):
 * FINANCIAL_RULE, USER_PREFERENCE, CONVERSATION_SUMMARY, TRANSACTION_NOTE, DOCUMENT
 */
export const contextTypeEnum = pgEnum('context_type', [
  'FINANCIAL_RULE',
  'USER_PREFERENCE',
  'CONVERSATION_SUMMARY',
  'TRANSACTION_NOTE',
  'DOCUMENT',
]);

/**
 * Tabla: agent_memories
 * Almacena memorias semánticas vectoriales para el Agente IA con pgvector.
 * Incluye un índice HNSW para optimizar búsquedas por similitud coseno (<=>).
 */
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    contextType: contextTypeEnum('context_type').notNull().default('CONVERSATION_SUMMARY'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_memories_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('agent_memories_tenant_id_idx').on(table.tenantId),
    index('agent_memories_tenant_context_idx').on(table.tenantId, table.contextType),
    index('agent_memories_user_id_idx').on(table.userId),
    index('agent_memories_created_at_idx').on(table.createdAt),
  ],
);

export type AgentMemory = typeof agentMemories.$inferSelect;
export type NewAgentMemory = typeof agentMemories.$inferInsert;

/**
 * Tabla: agent_token_budgets
 * Almacena el presupuesto mensual por tenant para llamadas LLM.
 * Costes y límites expresados en micro-USD (1 USD = 1,000,000 micro-USD) conforme a ADR-003.
 */
export const agentTokenBudgets = pgTable(
  'agent_token_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    periodKey: varchar('period_key', { length: 7 }).notNull(), // 'YYYY-MM' en UTC
    limitMicroUsd: bigint('limit_micro_usd', { mode: 'number' }).notNull(),
    spentMicroUsd: bigint('spent_micro_usd', { mode: 'number' }).notNull().default(0),
    reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'number' }).notNull().default(0),
    warnRatio: doublePrecision('warn_ratio').notNull().default(0.8),
    hardLimit: boolean('hard_limit').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_token_budgets_tenant_period_uq').on(table.tenantId, table.periodKey),
    index('agent_token_budgets_tenant_idx').on(table.tenantId),
  ],
);

export type AgentTokenBudget = typeof agentTokenBudgets.$inferSelect;
export type NewAgentTokenBudget = typeof agentTokenBudgets.$inferInsert;

/**
 * Tabla: agent_token_usage
 * Registro inmutable del consumo de tokens por petición/conversación.
 */
export const agentTokenUsage = pgTable(
  'agent_token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    correlationId: varchar('correlation_id', { length: 255 }),
    conversationId: varchar('conversation_id', { length: 255 }),
    model: varchar('model', { length: 100 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    cacheHit: boolean('cache_hit').notNull().default(false),
    degraded: boolean('degraded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_token_usage_tenant_created_idx').on(table.tenantId, table.createdAt),
    uniqueIndex('agent_token_usage_tenant_correlation_uq')
      .on(table.tenantId, table.correlationId)
      .where(sql`${table.correlationId} IS NOT NULL`),
  ],
);

export type AgentTokenUsage = typeof agentTokenUsage.$inferSelect;
export type NewAgentTokenUsage = typeof agentTokenUsage.$inferInsert;

/**
 * Tabla: agent_semantic_cache
 * Caché semántica de respuestas para evitar llamadas repetidas al LLM.
 * Búsqueda exacta vía SHA-256(prompt) y búsqueda por similitud vectorial con HNSW cosine.
 */
export const agentSemanticCache = pgTable(
  'agent_semantic_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    promptHash: varchar('prompt_hash', { length: 64 }).notNull(),
    prompt: text('prompt').notNull(),
    response: text('response').notNull(),
    promptEmbedding: vector('prompt_embedding', { dimensions: 1536 }),
    similarityThreshold: doublePrecision('similarity_threshold').notNull().default(0.95),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_semantic_cache_tenant_hash_uq').on(table.tenantId, table.promptHash),
    index('agent_semantic_cache_tenant_expires_idx').on(table.tenantId, table.expiresAt),
    index('agent_semantic_cache_embedding_hnsw_idx').using(
      'hnsw',
      table.promptEmbedding.op('vector_cosine_ops'),
    ),
  ],
);

export type AgentSemanticCache = typeof agentSemanticCache.$inferSelect;
export type NewAgentSemanticCache = typeof agentSemanticCache.$inferInsert;

/**
 * Tabla: agent_token_reservations
 * Registro de reservas concurrentes de saldo previo a invocar al LLM.
 */
export const agentTokenReservations = pgTable(
  'agent_token_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    correlationId: varchar('correlation_id', { length: 255 }).notNull(),
    estimatedCostMicroUsd: bigint('estimated_cost_micro_usd', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // 'ACTIVE', 'SETTLED', 'RELEASED'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_token_reservations_tenant_correlation_uq').on(
      table.tenantId,
      table.correlationId,
    ),
    index('agent_token_reservations_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export type AgentTokenReservation = typeof agentTokenReservations.$inferSelect;
export type NewAgentTokenReservation = typeof agentTokenReservations.$inferInsert;

/**
 * Tabla: agent_budget_events
 * Almacena eventos para deduplicación estricta por período (ej. agent.budget.exhausted emitido una sola vez por mes).
 */
export const agentBudgetEvents = pgTable(
  'agent_budget_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    periodKey: varchar('period_key', { length: 7 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_budget_events_tenant_period_event_uq').on(
      table.tenantId,
      table.periodKey,
      table.eventType,
    ),
  ],
);

export type AgentBudgetEvent = typeof agentBudgetEvents.$inferSelect;
export type NewAgentBudgetEvent = typeof agentBudgetEvents.$inferInsert;
