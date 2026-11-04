import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  HttpException,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { AuditEvents, type CreateAuditLogEvent } from '@mybusiness/contracts';
import { GlobalExceptionFilter } from '@mybusiness/common';
import type { Request } from 'express';

/**
 * Tenant centinela para eventos de seguridad sin identidad (401/403 antes del login).
 * Debe ser un UUID válido porque `audit_logs.tenant_id` es uuid NOT NULL.
 */
export const UNAUTHENTICATED_TENANT_ID = '00000000-0000-0000-0000-000000000000';

interface SecurityAuditRequest extends Request {
  user?: {
    tenantId?: string;
    userId?: string;
    role?: CreateAuditLogEvent['role'];
  };
}

/**
 * Filtro global que audita los rechazos de autorización (401/403) y cualquier
 * violación del contexto de tenant antes de delegar en el filtro global común.
 *
 * La emisión al microservicio de auditoría es *fire-and-forget*: si Redis está
 * caído o el broker no responde se registra un warning y la petición continúa
 * su curso normal. Nunca bloquea ni propaga el fallo de auditoría.
 */
@Catch()
export class SecurityAuditFilter extends GlobalExceptionFilter {
  private readonly auditLogger = new Logger(SecurityAuditFilter.name);

  constructor(@Inject('AUDIT_SERVICE') private readonly auditClient: ClientProxy) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<SecurityAuditRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (this.isSecurityViolation(exception, status)) {
      this.emitAuditEvent(exception, request, status);
    }

    super.catch(exception, host);
  }

  private isSecurityViolation(exception: unknown, status: number): boolean {
    if (exception instanceof UnauthorizedException || exception instanceof ForbiddenException) {
      return true;
    }

    if (!(exception instanceof HttpException) || status < 400 || status >= 500) {
      return false;
    }

    const response = exception.getResponse();
    const message =
      typeof response === 'string' ? response : JSON.stringify((response as any)?.message ?? '');
    return /tenant/i.test(message);
  }

  private emitAuditEvent(exception: unknown, request: SecurityAuditRequest, status: number): void {
    const user = request?.user;
    const reason = exception instanceof Error ? exception.message : String(exception);

    const event: CreateAuditLogEvent = {
      eventId: randomUUID(),
      // Un 401 puede ocurrir antes de identificar al tenant; se usa un valor
      // explícito para que el evento siga siendo auditable sin inventar un tenant.
      tenantId: user?.tenantId || UNAUTHENTICATED_TENANT_ID,
      userId: user?.userId,
      role: user?.role,
      action: `SECURITY_${status}_${request?.method ?? 'UNKNOWN'}`,
      entityName: request?.originalUrl || request?.url || 'http',
      ipAddress: request?.ip,
      userAgent: request?.headers?.['user-agent'] as string | undefined,
      timestamp: new Date().toISOString(),
      newValues: {
        statusCode: status,
        reason,
      },
    };

    try {
      this.auditClient
        .emit(AuditEvents.LOG_EVENT, event)
        .subscribe({ error: (error) => this.warnAuditFailure(error) });
    } catch (error) {
      this.warnAuditFailure(error);
    }
  }

  private warnAuditFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.auditLogger.warn(`No se pudo emitir el evento de auditoría de seguridad: ${message}`);
  }
}
