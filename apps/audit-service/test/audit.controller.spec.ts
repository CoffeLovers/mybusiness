import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditController } from '../src/audit.controller';
import type { AuditService } from '../src/audit.service';
import type {
  CreateAuditLogEvent,
  TransactionCreatedEvent,
  InvoicePaidEvent,
} from '@mybusiness/contracts';

describe('AuditController (EventPattern & MessagePattern)', () => {
  let controller: AuditController;
  let mockAuditService: {
    recordLog: ReturnType<typeof vi.fn>;
    handleDomainEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockAuditService = {
      recordLog: vi.fn(),
      handleDomainEvent: vi.fn(),
    };
    controller = new AuditController(mockAuditService as unknown as AuditService);
  });

  it('procesa el evento audit.log_event asíncronamente con recordLog', async () => {
    const event: CreateAuditLogEvent = {
      tenantId: 'tenant-1',
      action: 'auth.login',
      entityName: 'User',
    };
    mockAuditService.recordLog.mockResolvedValueOnce({
      success: true,
      tenantId: 'tenant-1',
      duplicate: false,
    });

    const result = await controller.handleAuditLogEvent(event);

    expect(mockAuditService.recordLog).toHaveBeenCalledWith(event);
    expect(result).toEqual({ success: true, tenantId: 'tenant-1', duplicate: false });
  });

  it('procesa el evento finance.transaction.created con handleDomainEvent', async () => {
    const event: TransactionCreatedEvent = {
      eventId: 'evt-1',
      tenantId: 'tenant-1',
      transactionId: 'tx-1',
      bankAccountId: 'ba-1',
      amountMinor: '1000',
      currency: 'COP',
      type: 'INCOME',
      occurredAt: '2026-10-30T00:00:00.000Z',
    };
    mockAuditService.handleDomainEvent.mockResolvedValueOnce({
      success: true,
      tenantId: 'tenant-1',
      duplicate: false,
    });

    const result = await controller.handleTransactionCreated(event);

    expect(mockAuditService.handleDomainEvent).toHaveBeenCalledWith(
      'finance.transaction.created',
      'Transaction',
      event,
    );
    expect(result).toEqual({ success: true, tenantId: 'tenant-1', duplicate: false });
  });

  it('procesa el evento finance.invoice.paid con handleDomainEvent', async () => {
    const event: InvoicePaidEvent = {
      eventId: 'evt-inv-1',
      tenantId: 'tenant-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-001',
      totalAmountMinor: '50000',
      currency: 'COP',
      occurredAt: '2026-10-30T00:00:00.000Z',
    };
    mockAuditService.handleDomainEvent.mockResolvedValueOnce({
      success: true,
      tenantId: 'tenant-1',
      duplicate: false,
    });

    const result = await controller.handleInvoicePaid(event);

    expect(mockAuditService.handleDomainEvent).toHaveBeenCalledWith(
      'finance.invoice.paid',
      'Invoice',
      event,
    );
    expect(result).toEqual({ success: true, tenantId: 'tenant-1', duplicate: false });
  });

  it('no arroja error hacia el broker si ocurre un fallo en el procesamiento de eventos (fire-and-forget)', async () => {
    const event: CreateAuditLogEvent = {
      tenantId: 'tenant-1',
      action: 'bad.event',
      entityName: 'Bad',
    };
    mockAuditService.recordLog.mockRejectedValueOnce(new Error('DB failure'));

    await expect(controller.handleAuditLogEvent(event)).resolves.toBeUndefined();
  });

  it('atiende peticiones RPC síncronas vía handleAuditLogRpc', async () => {
    const event: CreateAuditLogEvent = {
      tenantId: 'tenant-1',
      action: 'rpc.log',
      entityName: 'System',
    };
    mockAuditService.recordLog.mockResolvedValueOnce({
      success: true,
      tenantId: 'tenant-1',
      auditLogId: 'log-123',
      duplicate: false,
    });

    const result = await controller.handleAuditLogRpc(event);

    expect(mockAuditService.recordLog).toHaveBeenCalledWith(event);
    expect(result).toEqual({
      success: true,
      tenantId: 'tenant-1',
      auditLogId: 'log-123',
      duplicate: false,
    });
  });
});
