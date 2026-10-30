import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CreateAuditLogEvent } from '@mybusiness/contracts';
import { extractRpcContext } from '@mybusiness/common';
import { AuditRepository } from './audit.repository';
import type { AuditLog } from './database/schema';

export interface AuditResult {
  success: boolean;
  tenantId: string;
  auditLogId?: string;
  duplicate?: boolean;
}

/**
 * Servicio de dominio de trazabilidad inmutable y append-only.
 *
 * REGLAS DE ARQUITECTURA (Issue #15, ADR-002, ADR-004):
 * - Persiste AuditLog exclusivamente mediante operaciones INSERT (append-only).
 * - Garantiza idempotencia ante reentregas utilizando `eventId`.
 * - Es desacoplado y tolerante a fallos: procesa eventos emitidos de manera asíncrona.
 * - Respeta estrictamente el contexto multi-tenant.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repository: AuditRepository) {}

  /**
   * Registra un evento de auditoría de forma append-only e idempotente.
   */
  async recordLog(event: CreateAuditLogEvent): Promise<AuditResult> {
    const ctx = extractRpcContext(event);
    const tenantId = ctx.tenantId || event.tenantId;

    if (!tenantId) {
      this.logger.error('Evento de auditoría descartado: tenantId ausente.');
      throw new BadRequestException('tenantId es requerido en el evento de auditoría.');
    }

    if (!event.action) {
      this.logger.error('Evento de auditoría descartado: action ausente.');
      throw new BadRequestException('action es requerido en el evento de auditoría.');
    }

    if (!event.entityName) {
      this.logger.error('Evento de auditoría descartado: entityName ausente.');
      throw new BadRequestException('entityName es requerido en el evento de auditoría.');
    }

    const userId = ctx.userId || event.userId;
    const eventId = event.eventId;

    // Validación de idempotencia: si se provee eventId y ya fue procesado, no duplicar
    if (eventId) {
      const existing = await this.repository.findByEventId(tenantId, eventId);
      if (existing) {
        this.logger.warn(
          `[AUDIT IDEMPOTENCY] Evento duplicado detectado para tenant=${tenantId}, eventId=${eventId}. Omitiendo inserción.`,
        );
        return {
          success: true,
          tenantId,
          auditLogId: existing.id,
          duplicate: true,
        };
      }
    }

    // Persistir nuevo registro inmutable
    const newValuesPayload = {
      ...(event.newValues ?? {}),
      ...(eventId ? { eventId } : {}),
      ...(ctx.role || event.role ? { role: ctx.role || event.role } : {}),
    };

    const inserted: AuditLog = await this.repository.insertLog({
      tenantId,
      userId: userId || null,
      action: event.action,
      entityName: event.entityName,
      entityId: event.entityId || (eventId ? `evt-${eventId}` : null),
      oldValues: event.oldValues || null,
      newValues: newValuesPayload,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent || null,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    });

    this.logger.log(
      `[AUDIT APPEND-ONLY] id=${inserted.id} tenant=${tenantId} user=${userId ?? 'system'} acción=${event.action} entidad=${event.entityName}`,
    );

    return {
      success: true,
      tenantId,
      auditLogId: inserted.id,
      duplicate: false,
    };
  }

  /**
   * Consumo específico de eventos de dominio emitidos por finance-service o auth-service.
   */
  async handleDomainEvent(
    action: string,
    entityName: string,
    payload: Record<string, unknown>,
  ): Promise<AuditResult> {
    const tenantId = (payload.tenantId as string) || '';
    const userId = (payload.userId as string) || undefined;
    const eventId = (payload.eventId as string) || undefined;
    const timestamp =
      (payload.occurredAt as string) || (payload.timestamp as string) || new Date().toISOString();

    const entityId =
      (payload.transactionId as string) ||
      (payload.invoiceId as string) ||
      (payload.id as string) ||
      eventId;

    return this.recordLog({
      eventId,
      tenantId,
      userId,
      action,
      entityName,
      entityId,
      newValues: payload,
      timestamp,
    });
  }
}
