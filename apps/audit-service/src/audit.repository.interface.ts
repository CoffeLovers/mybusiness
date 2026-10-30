import type { AuditLog, NewAuditLog } from './database/schema';

export interface IAuditRepository {
  /**
   * Inserta un nuevo registro de auditoría en la tabla inmutable audit_logs.
   * OPERACIÓN ESTRICTAMENTE APPEND-ONLY: no se permiten métodos update ni delete.
   */
  insertLog(entry: NewAuditLog): Promise<AuditLog>;

  /**
   * Consulta si ya existe un evento registrado para garantizar idempotencia en reentregas.
   */
  findByEventId(tenantId: string, eventId: string): Promise<AuditLog | null>;
}
