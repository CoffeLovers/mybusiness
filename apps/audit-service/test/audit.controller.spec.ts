import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditController } from '../src/audit.controller';
import type { AuditService } from '../src/audit.service';
import type {
  CreateAuditLogEvent,
  TransactionCreatedEvent,
  InvoicePaidEvent,
} from '@mybusiness/contracts';

type MockFn = ReturnType<typeof vi.fn>;

interface MockAuditService {
  recordLog: MockFn;
  handleDomainEvent: MockFn;
  quarantine: MockFn;
}

describe('AuditController (EventPattern, reintentos y cuarentena)', () => {
  let controller: AuditController;
  let mockAuditService: MockAuditService;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  const buildEvent = (overrides: Partial<CreateAuditLogEvent> = {}): CreateAuditLogEvent => ({
    eventId: randomUUID(),
    tenantId,
    userId: 'usr-1',
    action: 'auth.login',
    entityName: 'User',
    ...overrides,
  });

  beforeEach(() => {
    mockAuditService = {
      recordLog: vi.fn(),
      handleDomainEvent: vi.fn(),
      quarantine: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    controller = new AuditController(mockAuditService as unknown as AuditService);
  });

  it('handleAuditLogEvent procesa el evento y devuelve el resultado', async () => {
    const event = buildEvent();
    const expected = { success: true, tenantId, duplicate: false };
    mockAuditService.recordLog.mockResolvedValueOnce(expected);

    const result = await controller.handleAuditLogEvent(event);

    expect(mockAuditService.recordLog).toHaveBeenCalledWith(event);
    expect(result).toEqual(expected);
  });

  it('handleTransactionCreated delega en handleDomainEvent', async () => {
    const event: TransactionCreatedEvent = {
      eventId: randomUUID(),
      tenantId,
      userId: 'usr-1',
      transactionId: 'tx-1',
      bankAccountId: 'ba-1',
      amountMinor: '1000',
      currency: 'COP',
      type: 'INCOME',
      occurredAt: '2026-10-30T00:00:00.000Z',
    };
    const expected = { success: true, tenantId, duplicate: false };
    mockAuditService.handleDomainEvent.mockResolvedValueOnce(expected);

    const result = await controller.handleTransactionCreated(event);

    expect(mockAuditService.handleDomainEvent).toHaveBeenCalledWith(
      'finance.transaction.created',
      'Transaction',
      event,
    );
    expect(result).toEqual(expected);
  });

  it('handleInvoicePaid delega en handleDomainEvent', async () => {
    const event: InvoicePaidEvent = {
      eventId: randomUUID(),
      tenantId,
      userId: 'usr-1',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-001',
      totalAmountMinor: '50000',
      currency: 'COP',
      occurredAt: '2026-10-30T00:00:00.000Z',
    };
    const expected = { success: true, tenantId, duplicate: false };
    mockAuditService.handleDomainEvent.mockResolvedValueOnce(expected);

    const result = await controller.handleInvoicePaid(event);

    expect(mockAuditService.handleDomainEvent).toHaveBeenCalledWith(
      'finance.invoice.paid',
      'Invoice',
      event,
    );
    expect(result).toEqual(expected);
  });

  it('reintenta un fallo transitorio y no llama a quarantine si el tercer intento tiene éxito', async () => {
    const event = buildEvent({ action: 'transient.event' });
    const expected = { success: true, tenantId, duplicate: false };
    mockAuditService.recordLog
      .mockRejectedValueOnce(new Error('fallo 1'))
      .mockRejectedValueOnce(new Error('fallo 2'))
      .mockResolvedValueOnce(expected);

    const result = await controller.handleAuditLogEvent(event);

    expect(mockAuditService.recordLog).toHaveBeenCalledTimes(3);
    expect(result).toEqual(expected);
    expect(mockAuditService.quarantine).not.toHaveBeenCalled();
  });

  it('envía a cuarentena con attempts: 3 ante un fallo persistente y no propaga el error', async () => {
    const event = buildEvent({ action: 'persistent.event' });
    mockAuditService.recordLog.mockRejectedValue(new Error('DB caída'));

    await expect(controller.handleAuditLogEvent(event)).resolves.toBeUndefined();

    expect(mockAuditService.recordLog).toHaveBeenCalledTimes(3);
    expect(mockAuditService.quarantine).toHaveBeenCalledTimes(1);
    expect(mockAuditService.quarantine).toHaveBeenCalledWith(
      'audit.log_event',
      event,
      'DB caída',
      3,
    );
  });

  it('handleAuditLogRpc propaga el error sin pasar por cuarentena', async () => {
    const event = buildEvent({ action: 'rpc.log' });
    mockAuditService.recordLog.mockRejectedValueOnce(new Error('RPC failure'));

    await expect(controller.handleAuditLogRpc(event)).rejects.toThrow('RPC failure');
    expect(mockAuditService.quarantine).not.toHaveBeenCalled();
  });
});
