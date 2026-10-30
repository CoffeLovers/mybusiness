import { Controller, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  AuditEvents,
  FinanceEvents,
  type CreateAuditLogEvent,
  type TransactionCreatedEvent,
  type InvoicePaidEvent,
} from '@mybusiness/contracts';
import { AuditService, type AuditResult } from './audit.service';

/**
 * Controlador de eventos asíncronos para audit-service.
 *
 * Utiliza @EventPattern para consumo asíncrono no bloqueante (fire-and-forget)
 * mediante el bus Redis según ADR-002.
 * Adicionalmente provee compatibilidad con @MessagePattern para peticiones RPC directas
 * de logging sin romper consumidores existentes.
 */
@Controller()
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Consumo asíncrono del evento genérico de auditoría audit.log_event.
   */
  @EventPattern(AuditEvents.LOG_EVENT)
  async handleAuditLogEvent(@Payload() event: CreateAuditLogEvent): Promise<AuditResult | void> {
    try {
      return await this.auditService.recordLog(event);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error procesando audit.log_event: ${msg}`);
      return undefined;
    }
  }

  /**
   * Consumo asíncrono de eventos de dominio emitidos por finance-service: TransactionCreated.
   */
  @EventPattern(FinanceEvents.TRANSACTION_CREATED)
  async handleTransactionCreated(
    @Payload() event: TransactionCreatedEvent,
  ): Promise<AuditResult | void> {
    try {
      return await this.auditService.handleDomainEvent(
        'finance.transaction.created',
        'Transaction',
        event as unknown as Record<string, unknown>,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error procesando finance.transaction.created: ${msg}`);
      return undefined;
    }
  }

  /**
   * Consumo asíncrono de eventos de dominio emitidos por finance-service: InvoicePaid.
   */
  @EventPattern(FinanceEvents.INVOICE_PAID)
  async handleInvoicePaid(@Payload() event: InvoicePaidEvent): Promise<AuditResult | void> {
    try {
      return await this.auditService.handleDomainEvent(
        'finance.invoice.paid',
        'Invoice',
        event as unknown as Record<string, unknown>,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error procesando finance.invoice.paid: ${msg}`);
      return undefined;
    }
  }

  /**
   * Soporte RPC para envío síncrono o invocaciones request-response si aplica.
   */
  @MessagePattern(AuditEvents.LOG_EVENT)
  async handleAuditLogRpc(@Payload() event: CreateAuditLogEvent): Promise<AuditResult> {
    return this.auditService.recordLog(event);
  }
}
