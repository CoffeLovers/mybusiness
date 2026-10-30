import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CreateAuditLogEvent } from '@mybusiness/contracts';
import { AuditRepository } from './audit.repository';

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
    const tenantId = event.tenantId;
    if (!tenantId) {
      this.logger.error('Evento de auditoría descartado: tenantId ausente.');
      throw new BadRequestException('tenantId es requerido en el evento de auditoría.');
    }

    const eventId = event.eventId;
    if (!eventId) {
      this.logger.error('Evento de auditoría descartado: eventId ausente.');
      throw new BadRequestException('eventId es requerido en el evento de auditoría.');
    }

    const action = event.action;
    if (!action) {
      this.logger.error('Evento de auditoría descartado: action ausente.');
      throw new BadRequestException('action es requerido en el evento de auditoría.');
    }

    const entityName = event.entityName;
    if (!entityName) {
      this.logger.error('Evento de auditoría descartado: entityName ausente.');
      throw new BadRequestException('entityName es requerido en el evento de auditoría.');
    }

    const userId = event.userId ?? null;
    const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
    if (Number.isNaN(timestamp.getTime())) {
      this.logger.error('Evento de auditoría descartado: timestamp inválido.');
      throw new BadRequestException('timestamp inválido en el evento de auditoría.');
    }

    const { log, created } = await this.repository.insertLogIdempotent({
      tenantId,
      eventId,
      userId,
      action,
      entityName,
      entityId: event.entityId ?? null,
      oldValues: event.oldValues ?? null,
      newValues: event.newValues ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      timestamp,
    });

    this.logger.log(
      `[AUDIT APPEND-ONLY] id=${log.id} tenant=${tenantId} user=${userId ?? 'system'} acción=${action} entidad=${entityName}`,
    );

    return {
      success: true,
      tenantId,
      auditLogId: log.id,
      duplicate: !created,
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
    if (!tenantId) {
      throw new BadRequestException('tenantId es requerido en el evento de dominio.');
    }

    const eventId = (payload.eventId as string) || '';
    if (!eventId) {
      throw new BadRequestException('eventId es requerido en el evento de dominio.');
    }

    const userId = (payload.userId as string) || undefined;
    const entityId =
      (payload.transactionId as string) ||
      (payload.invoiceId as string) ||
      (payload.id as string) ||
      null;
    const timestamp = (payload.occurredAt as string) || (payload.timestamp as string) || undefined;

    return this.recordLog({
      eventId,
      tenantId,
      userId,
      action,
      entityName,
      entityId: entityId ?? undefined,
      newValues: payload,
      timestamp,
    });
  }

  /**
   * Persiste un evento irrecuperable en la tabla de cuarentena sin filtrar su payload.
   */
  async quarantine(
    eventType: string,
    payload: Record<string, unknown>,
    error: string,
    attempts: number,
  ): Promise<void> {
    try {
      await this.repository.quarantine({
        tenantId: (payload.tenantId as string) || null,
        eventType,
        payload,
        error,
        attempts,
      });
    } catch (quarantineError) {
      const name =
        quarantineError instanceof Error ? quarantineError.name : String(quarantineError);
      this.logger.error(`No se pudo registrar el evento en cuarentena: ${name}`);
    }
  }
}
