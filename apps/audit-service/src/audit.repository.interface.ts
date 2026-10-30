import type { AuditDeadLetter, AuditLog, NewAuditDeadLetter, NewAuditLog } from './database/schema';

export interface InsertAuditResult {
  log: AuditLog;
  created: boolean;
}

export interface IAuditRepository {
  /** Inserta de forma atómica; si (tenantId,eventId) ya existe devuelve el registro previo. */
  insertLogIdempotent(entry: NewAuditLog & { eventId: string }): Promise<InsertAuditResult>;
  findByEventId(tenantId: string, eventId: string): Promise<AuditLog | null>;
  quarantine(entry: NewAuditDeadLetter): Promise<AuditDeadLetter>;
}
