import { Injectable, Logger } from '@nestjs/common';
import { CreateAuditLogEvent } from '@mybusiness/contracts';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async recordLog(event: CreateAuditLogEvent) {
    this.logger.log(
      `[AUDIT APPEND-ONLY] Evento registrado: ${event.action} sobre ${event.entityName}`,
    );
    return { success: true };
  }
}
