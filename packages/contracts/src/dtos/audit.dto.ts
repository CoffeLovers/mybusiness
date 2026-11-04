import { UserRole } from '../enums';

export interface CreateAuditLogEvent {
  eventId: string;
  tenantId: string;
  userId?: string;
  role?: UserRole;
  action: string;
  entityName: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp?: string;
}

/** DTO alias para compatibilidad */
export type CreateAuditLogDto = CreateAuditLogEvent;

/** Payload de evento de log de auditoría */
export type AuditLogEventPayload = CreateAuditLogEvent;

/** Payload RPC/evento de auditoría con contexto multi-tenant. */
export type AuditLogRpcPayload = CreateAuditLogEvent;
