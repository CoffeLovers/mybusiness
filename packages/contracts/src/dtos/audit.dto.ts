import { UserRole } from '../enums';

export interface CreateAuditLogEvent {
  tenantId: string;
  userId?: string;
  role?: UserRole;
  action: string;
  entityName: string;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

/** Payload RPC/evento de auditoría con contexto multi-tenant. */
export type AuditLogRpcPayload = CreateAuditLogEvent;
