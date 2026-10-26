import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AuditEvents, CreateAuditLogEvent } from '@mybusiness/contracts';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @EventPattern(AuditEvents.LOG_EVENT)
  handleAuditLog(@Payload() event: CreateAuditLogEvent) {
    return this.auditService.recordLog(event);
  }
}
