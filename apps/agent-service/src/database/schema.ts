import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

/**
 * Los valores de este enum se mantienen alineados con `@mybusiness/contracts` (ContextType):
 * FINANCIAL_RULE, USER_PREFERENCE, CONVERSATION_SUMMARY, TRANSACTION_NOTE
 */
export const contextTypeEnum = pgEnum('context_type', [
  'FINANCIAL_RULE',
  'USER_PREFERENCE',
  'CONVERSATION_SUMMARY',
  'TRANSACTION_NOTE',
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
