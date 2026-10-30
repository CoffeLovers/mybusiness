import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuditDatabaseService } from './database/database.service';
import { auditLogs, type AuditLog, type NewAuditLog } from './database/schema';
import type { IAuditRepository } from './audit.repository.interface';

/**
 * Repositorio de persistencia inmutable para audit-service.
 *
 * POLÍTICA DE SEGURIDAD / APPEND-ONLY:
 * Este repositorio ÚNICAMENTE expone inserción (`insertLog`) y consultas de lectura (`findByEventId`).
 * No implementa ni implementará jamás métodos de UPDATE ni DELETE sobre la tabla `audit_logs`.
 * Además, la base de datos cuenta con triggers que abortan cualquier intento de UPDATE o DELETE.
 */
@Injectable()
export class AuditRepository implements IAuditRepository {
  constructor(private readonly databaseService: AuditDatabaseService) {}

  /**
   * Inserta un nuevo registro inmutable en audit_logs.
   */
  async insertLog(entry: NewAuditLog): Promise<AuditLog> {
    const [inserted] = await this.databaseService.db.insert(auditLogs).values(entry).returning();

    return inserted;
  }

  /**
   * Busca si existe un registro previo con el mismo eventId en newValues o oldValues para garantizar idempotencia.
   * Utiliza el operador de extracción JSONB `->>` de PostgreSQL.
   */
  async findByEventId(tenantId: string, eventId: string): Promise<AuditLog | null> {
    const [found] = await this.databaseService.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          sql`(${auditLogs.newValues}->>'eventId' = ${eventId} OR ${auditLogs.entityId} = ${eventId})`,
        ),
      )
      .limit(1);

    return found ?? null;
  }
}
