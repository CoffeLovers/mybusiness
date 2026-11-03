import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { AuditEvents, type CreateAuditLogEvent, type UserRole } from '@mybusiness/contracts';

export interface McpAuditEvent {
  tenantId: string;
  userId: string;
  role: string;
  tool: string;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
  resultSize?: number;
}

/**
 * Publica un evento de auditoría por cada invocación de herramienta MCP.
 *
 * Es *best-effort*: si el bus o el servicio de auditoría no responden, la
 * invocación continúa. Los logs solo incluyen el nombre del error para no
 * filtrar argumentos, resultados ni identificadores del tenant.
 */
@Injectable()
export class McpAuditPublisher {
  private readonly logger = new Logger(McpAuditPublisher.name);

  constructor(@Inject('AUDIT_SERVICE') private readonly client: ClientProxy) {}

  async publish(event: McpAuditEvent): Promise<void> {
    const payload: CreateAuditLogEvent = {
      eventId: randomUUID(),
      tenantId: event.tenantId,
      userId: event.userId,
      role: event.role as UserRole,
      action: 'mcp.tool.invoked',
      entityName: 'mcp_tool',
      entityId: event.tool,
      newValues: {
        ok: event.ok,
        latencyMs: event.latencyMs,
        errorCode: event.errorCode,
        resultSize: event.resultSize,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await firstValueFrom(
        this.client.emit<unknown, CreateAuditLogEvent>(AuditEvents.LOG_EVENT, payload),
      );
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`No se pudo emitir la auditoría de la herramienta MCP: ${errorName}`);
    }
  }
}
