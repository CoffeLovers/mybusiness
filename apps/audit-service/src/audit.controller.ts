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

  private async processWithRetry(
    eventType: string,
    payload: Record<string, unknown>,
    handler: () => Promise<AuditResult>,
  ): Promise<AuditResult | void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await handler();
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    this.logger.error(`Evento ${eventType} falló tras 3 intentos: ${message}`);
    await this.auditService.quarantine(eventType, payload, message, 3);
    return undefined;
  }

  /**
   * Consumo asíncrono del evento genérico de auditoría audit.log_event.
   */
  @EventPattern(AuditEvents.LOG_EVENT)
  async handleAuditLogEvent(@Payload() event: CreateAuditLogEvent): Promise<AuditResult | void> {
    return this.processWithRetry(
      AuditEvents.LOG_EVENT,
      event as unknown as Record<string, unknown>,
      () => this.auditService.recordLog(event),
    );
  }

  /**
   * Consumo asíncrono de eventos de dominio emitidos por finance-service: TransactionCreated.
   */
  @EventPattern(FinanceEvents.TRANSACTION_CREATED)
  async handleTransactionCreated(
    @Payload() event: TransactionCreatedEvent,
  ): Promise<AuditResult | void> {
    const payload = event as unknown as Record<string, unknown>;
    return this.processWithRetry(FinanceEvents.TRANSACTION_CREATED, payload, () =>
      this.auditService.handleDomainEvent('finance.transaction.created', 'Transaction', payload),
    );
  }

  /**
   * Consumo asíncrono de eventos de dominio emitidos por finance-service: InvoicePaid.
   */
  @EventPattern(FinanceEvents.INVOICE_PAID)
  async handleInvoicePaid(@Payload() event: InvoicePaidEvent): Promise<AuditResult | void> {
    const payload = event as unknown as Record<string, unknown>;
    return this.processWithRetry(FinanceEvents.INVOICE_PAID, payload, () =>
      this.auditService.handleDomainEvent('finance.invoice.paid', 'Invoice', payload),
    );
  }

  /**
   * Soporte RPC para envío síncrono o invocaciones request-response si aplica.
   */
  @MessagePattern(AuditEvents.LOG_EVENT)
  async handleAuditLogRpc(@Payload() event: CreateAuditLogEvent): Promise<AuditResult> {
    return this.auditService.recordLog(event);
  }
}
