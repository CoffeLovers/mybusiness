import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Tabla: audit_logs
 * Almacén inmutable y append-only para trazabilidad y auditoría de eventos.
 * Las operaciones UPDATE y DELETE están prohibidas a nivel de base de datos
 * mediante trigger/permisos.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    eventId: varchar('event_id', { length: 128 }),
    userId: uuid('user_id'),
    action: varchar('action', { length: 100 }).notNull(),
    entityName: varchar('entity_name', { length: 100 }).notNull(),
    entityId: varchar('entity_id', { length: 100 }),
    oldValues: jsonb('old_values').$type<Record<string, unknown>>(),
    newValues: jsonb('new_values').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_tenant_id_idx').on(table.tenantId),
    index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityName, table.entityId),
    index('audit_logs_tenant_action_idx').on(table.tenantId, table.action),
    index('audit_logs_timestamp_idx').on(table.timestamp),
    uniqueIndex('audit_logs_tenant_event_uq').on(table.tenantId, table.eventId),
  ],
);

/**
 * Tabla: audit_dead_letters
 * Cuarentena de eventos que no pudieron persistirse tras agotar reintentos.
 */
export const auditDeadLetters = pgTable('audit_dead_letters', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  error: text('error').notNull(),
  attempts: integer('attempts').notNull().default(1),
  failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type AuditDeadLetter = typeof auditDeadLetters.$inferSelect;
export type NewAuditDeadLetter = typeof auditDeadLetters.$inferInsert;
