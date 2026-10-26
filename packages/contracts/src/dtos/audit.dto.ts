export interface CreateAuditLogEvent {
  tenantId: string;
  userId?: string;
  action: string;
  entityName: string;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}
