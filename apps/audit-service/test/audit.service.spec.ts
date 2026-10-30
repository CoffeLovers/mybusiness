import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit.service';
import type { AuditRepository } from '../src/audit.repository';
import type { InsertAuditResult } from '../src/audit.repository.interface';
import type { AuditDeadLetter, AuditLog } from '../src/database/schema';
import type { CreateAuditLogEvent } from '@mybusiness/contracts';

type MockFn = ReturnType<typeof vi.fn>;

interface MockRepository {
  insertLogIdempotent: MockFn;
  findByEventId: MockFn;
  quarantine: MockFn;
}

describe('AuditService (Append-only & Idempotencia)', () => {
  let repository: MockRepository;
  let service: AuditService;

  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';

  const buildRow = (overrides: Partial<AuditLog> = {}): AuditLog => ({
    id: 'log-1',
    tenantId: tenantA,
    eventId: randomUUID(),
    userId: null,
    action: 'auth.login',
    entityName: 'User',
    entityId: 'usr-1',
    oldValues: null,
    newValues: { status: 'SUCCESS' },
    ipAddress: null,
    userAgent: null,
    timestamp: new Date('2026-10-30T00:00:00.000Z'),
    ...overrides,
  });

  const buildEvent = (overrides: Partial<CreateAuditLogEvent> = {}): CreateAuditLogEvent => ({
    eventId: randomUUID(),
    tenantId: tenantA,
    userId: 'usr-1',
    action: 'auth.login',
    entityName: 'User',
    entityId: 'usr-1',
    ...overrides,
  });

  beforeEach(() => {
    repository = {
      insertLogIdempotent: vi.fn<() => Promise<InsertAuditResult>>(),
      findByEventId: vi.fn(),
      quarantine: vi.fn<() => Promise<AuditDeadLetter>>(),
    };
    service = new AuditService(repository as unknown as AuditRepository);
  });

  it('persiste y retorna duplicate: false cuando el repositorio crea la fila', async () => {
    const event = buildEvent();
    const row = buildRow({ tenantId: event.tenantId, eventId: event.eventId });
    repository.insertLogIdempotent.mockResolvedValueOnce({ created: true, log: row });

    const result = await service.recordLog(event);

    expect(repository.insertLogIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: event.tenantId,
        eventId: event.eventId,
        action: event.action,
        entityName: event.entityName,
      }),
    );
    expect(result).toEqual({
      success: true,
      tenantId: event.tenantId,
      auditLogId: row.id,
      duplicate: false,
    });
  });

  it('marca duplicate: true en reentrega con el mismo eventId sin fallar', async () => {
    const event = buildEvent();
    const existing = buildRow({
      id: 'log-existing',
      tenantId: event.tenantId,
      eventId: event.eventId,
    });
    repository.insertLogIdempotent.mockResolvedValueOnce({ created: false, log: existing });

    const result = await service.recordLog(event);

    expect(result).toEqual({
      success: true,
      tenantId: event.tenantId,
      auditLogId: existing.id,
      duplicate: true,
    });
  });

  it('aísla el mismo eventId entre tenants distintos enviando su propio tenantId', async () => {
    const sharedEventId = randomUUID();
    repository.insertLogIdempotent
      .mockResolvedValueOnce({
        created: true,
        log: buildRow({ tenantId: tenantA, eventId: sharedEventId }),
      })
      .mockResolvedValueOnce({
        created: true,
        log: buildRow({ tenantId: tenantB, eventId: sharedEventId }),
      });

    await service.recordLog(buildEvent({ eventId: sharedEventId, tenantId: tenantA }));
    await service.recordLog(buildEvent({ eventId: sharedEventId, tenantId: tenantB }));

    expect(repository.insertLogIdempotent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: tenantA, eventId: sharedEventId }),
    );
    expect(repository.insertLogIdempotent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: tenantB, eventId: sharedEventId }),
    );
  });

  it('lanza BadRequestException si falta tenantId', async () => {
    const event = buildEvent({ tenantId: '' });

    await expect(service.recordLog(event)).rejects.toThrow(BadRequestException);
    expect(repository.insertLogIdempotent).not.toHaveBeenCalled();
  });

  it('lanza BadRequestException si falta eventId', async () => {
    const event = {
      tenantId: tenantA,
      action: 'auth.login',
      entityName: 'User',
    } as unknown as CreateAuditLogEvent;

    await expect(service.recordLog(event)).rejects.toThrow(BadRequestException);
    expect(repository.insertLogIdempotent).not.toHaveBeenCalled();
  });

  it('handleDomainEvent de TransactionCreated mapea entityId y newValues desde el payload', async () => {
    const eventId = randomUUID();
    const payload: Record<string, unknown> = {
      eventId,
      tenantId: tenantA,
      userId: 'usr-42',
      transactionId: 'tx-999',
      amountMinor: '125000',
      currency: 'COP',
      type: 'INCOME',
      occurredAt: '2026-10-30T00:00:00.000Z',
    };
    repository.insertLogIdempotent.mockResolvedValueOnce({
      created: true,
      log: buildRow({
        action: 'finance.transaction.created',
        entityName: 'Transaction',
        entityId: 'tx-999',
      }),
    });

    const result = await service.handleDomainEvent(
      'finance.transaction.created',
      'Transaction',
      payload,
    );

    expect(result.duplicate).toBe(false);
    expect(repository.insertLogIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        tenantId: tenantA,
        action: 'finance.transaction.created',
        entityName: 'Transaction',
        entityId: 'tx-999',
        newValues: payload,
      }),
    );
  });

  it('handleDomainEvent lanza BadRequestException si falta eventId', async () => {
    const payload: Record<string, unknown> = { tenantId: tenantA, transactionId: 'tx-1' };

    await expect(
      service.handleDomainEvent('finance.transaction.created', 'Transaction', payload),
    ).rejects.toThrow(BadRequestException);
  });

  it('quarantine delega en el repositorio con tenant, tipo, payload, error y attempts', async () => {
    const payload: Record<string, unknown> = { eventId: randomUUID(), tenantId: tenantA };
    repository.quarantine.mockResolvedValueOnce({
      id: 'dlq-1',
      tenantId: tenantA,
      eventType: 'audit.log_event',
      payload,
      error: 'DB failure',
      attempts: 3,
      failedAt: new Date('2026-10-30T00:00:00.000Z'),
    });

    await service.quarantine('audit.log_event', payload, 'DB failure', 3);

    expect(repository.quarantine).toHaveBeenCalledWith({
      tenantId: tenantA,
      eventType: 'audit.log_event',
      payload,
      error: 'DB failure',
      attempts: 3,
    });
  });

  it('quarantine no propaga el error si el repositorio falla', async () => {
    repository.quarantine.mockRejectedValueOnce(new Error('quarantine down'));

    await expect(
      service.quarantine('audit.log_event', { tenantId: tenantA }, 'boom', 3),
    ).resolves.toBeUndefined();
  });
});
