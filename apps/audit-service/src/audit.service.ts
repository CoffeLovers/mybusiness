import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreateAuditLogEvent } from '@mybusiness/contracts';
import { extractRpcContext } from '@mybusiness/common';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async recordLog(event: CreateAuditLogEvent) {
    const ctx = extractRpcContext(event);

    if (!ctx.tenantId) {
      throw new BadRequestException('tenantId es requerido en el evento de auditoría.');
    }

    const tenantId = ctx.tenantId;
    const userId = ctx.userId || event.userId;

    this.logger.log(
      `[AUDIT APPEND-ONLY] tenant=${tenantId} user=${userId ?? 'system'} role=${
        ctx.role ?? 'N/A'
      } evento: ${event.action} sobre ${event.entityName}`,
    );

    return { success: true, tenantId, userId };
  }
}
