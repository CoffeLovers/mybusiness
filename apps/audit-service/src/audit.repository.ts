import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditDatabaseService } from './database/database.service';
import {
  auditDeadLetters,
  auditLogs,
  type AuditDeadLetter,
  type AuditLog,
  type NewAuditDeadLetter,
  type NewAuditLog,
} from './database/schema';
import type { IAuditRepository, InsertAuditResult } from './audit.repository.interface';

/**
 * Repositorio de persistencia inmutable para audit-service.
 *
 * POLÍTICA DE SEGURIDAD / APPEND-ONLY:
 * Este repositorio ÚNICAMENTE expone inserción idempotente (`insertLogIdempotent`), consultas de
 * lectura (`findByEventId`) y cuarentena de fallos (`quarantine`).
 * No implementa ni implementará jamás métodos de UPDATE ni DELETE sobre la tabla `audit_logs`.
 * Además, la base de datos cuenta con triggers que abortan cualquier intento de UPDATE o DELETE.
 */
@Injectable()
export class AuditRepository implements IAuditRepository {
  constructor(private readonly databaseService: AuditDatabaseService) {}

  /**
   * Inserta de forma atómica un registro en audit_logs.
   * Si (tenantId, eventId) ya existe, no crea duplicado y devuelve el registro previo.
   */
  async insertLogIdempotent(entry: NewAuditLog & { eventId: string }): Promise<InsertAuditResult> {
    const [inserted] = await this.databaseService.db
      .insert(auditLogs)
      .values(entry)
      .onConflictDoNothing({ target: [auditLogs.tenantId, auditLogs.eventId] })
      .returning();

    if (inserted) {
      return { log: inserted, created: true };
    }

    const existing = await this.findByEventId(entry.tenantId, entry.eventId);
    if (!existing) {
      throw new Error('No se pudo resolver el evento de auditoría idempotente');
    }

    return { log: existing, created: false };
  }

  /**
   * Busca un registro por tenant y eventId para garantizar idempotencia en reentregas.
   */
  async findByEventId(tenantId: string, eventId: string): Promise<AuditLog | null> {
    const [found] = await this.databaseService.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.eventId, eventId)))
      .limit(1);

    return found ?? null;
  }

  /**
   * Persiste un evento irrecuperable en la tabla de cuarentena audit_dead_letters.
   */
  async quarantine(entry: NewAuditDeadLetter): Promise<AuditDeadLetter> {
    const [inserted] = await this.databaseService.db
      .insert(auditDeadLetters)
      .values(entry)
      .returning();

    return inserted;
  }
}
