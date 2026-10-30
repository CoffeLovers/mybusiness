import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit.service';
import type { IAuditRepository } from '../src/audit.repository.interface';
import type { AuditLog, NewAuditLog } from '../src/database/schema';
import type { CreateAuditLogEvent } from '@mybusiness/contracts';

class InMemoryAuditRepository implements IAuditRepository {
  public logs: AuditLog[] = [];
  public insertCalls = 0;

  async insertLog(entry: NewAuditLog): Promise<AuditLog> {
    this.insertCalls++;
    const created: AuditLog = {
      id: entry.id ?? `log-${Math.random().toString(36).substring(7)}`,
      tenantId: entry.tenantId,
      userId: entry.userId ?? null,
      action: entry.action,
      entityName: entry.entityName,
      entityId: entry.entityId ?? null,
      oldValues: (entry.oldValues as Record<string, unknown>) ?? null,
      newValues: (entry.newValues as Record<string, unknown>) ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(),
    };
    this.logs.push(created);
    return created;
  }

  async findByEventId(tenantId: string, eventId: string): Promise<AuditLog | null> {
    return (
      this.logs.find(
        (l) =>
          l.tenantId === tenantId &&
          ((l.newValues as Record<string, unknown>)?.eventId === eventId || l.entityId === eventId),
      ) ?? null
    );
  }
}

describe('AuditService (Append-only & Idempotency)', () => {
  let repository: InMemoryAuditRepository;
  let service: AuditService;

  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    repository = new InMemoryAuditRepository();
    service = new AuditService(repository as any);
  });

  it('persiste un evento de auditoría de forma append-only', async () => {
    const event: CreateAuditLogEvent = {
      tenantId: tenantA,
      userId: 'usr-1',
      action: 'auth.login',
      entityName: 'User',
      entityId: 'usr-1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      newValues: { status: 'SUCCESS' },
    };

    const result = await service.recordLog(event);

    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.tenantId).toBe(tenantA);
    expect(repository.insertCalls).toBe(1);
    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0].action).toBe('auth.login');
    expect(repository.logs[0].entityName).toBe('User');
    expect(repository.logs[0].tenantId).toBe(tenantA);
  });

  it('garantiza idempotencia: reentregas con el mismo eventId no duplican registros', async () => {
    const event: CreateAuditLogEvent = {
      eventId: 'evt-unique-1234',
      tenantId: tenantA,
      userId: 'usr-1',
      action: 'finance.transaction.created',
      entityName: 'Transaction',
      entityId: 'tx-100',
      newValues: { amountMinor: '5000' },
    };

    // Primera entrega
    const firstResult = await service.recordLog(event);
    expect(firstResult.success).toBe(true);
    expect(firstResult.duplicate).toBe(false);
    expect(repository.insertCalls).toBe(1);
    expect(repository.logs).toHaveLength(1);

    // Segunda entrega (reentrega / redelivery)
    const secondResult = await service.recordLog(event);
    expect(secondResult.success).toBe(true);
    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.auditLogId).toBe(firstResult.auditLogId);
    expect(repository.insertCalls).toBe(1); // No hubo nuevo insert
    expect(repository.logs).toHaveLength(1);
  });

  it('respeta el aislamiento multi-inquilino con el mismo eventId en distintos tenants', async () => {
    const eventA: CreateAuditLogEvent = {
      eventId: 'shared-event-id',
      tenantId: tenantA,
      action: 'invoice.create',
      entityName: 'Invoice',
    };

    const eventB: CreateAuditLogEvent = {
      eventId: 'shared-event-id',
      tenantId: tenantB,
      action: 'invoice.create',
      entityName: 'Invoice',
    };

    await service.recordLog(eventA);
    await service.recordLog(eventB);

    expect(repository.insertCalls).toBe(2);
    expect(repository.logs).toHaveLength(2);
    expect(repository.logs[0].tenantId).toBe(tenantA);
    expect(repository.logs[1].tenantId).toBe(tenantB);
  });

  it('lanza BadRequestException si tenantId no está presente', async () => {
    const event = {
      tenantId: '',
      action: 'system.event',
      entityName: 'System',
    } as CreateAuditLogEvent;

    await expect(service.recordLog(event)).rejects.toThrow(BadRequestException);
  });

  it('lanza BadRequestException si action o entityName faltan', async () => {
    await expect(
      service.recordLog({ tenantId: tenantA, action: '', entityName: 'Entity' } as any),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.recordLog({ tenantId: tenantA, action: 'action', entityName: '' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('maneja eventos de dominio (handleDomainEvent) de finance-service', async () => {
    const payload = {
      eventId: 'evt-tx-456',
      tenantId: tenantA,
      userId: 'usr-42',
      transactionId: 'tx-999',
      amountMinor: '125000',
      currency: 'COP',
      type: 'INCOME',
      occurredAt: new Date().toISOString(),
    };

    const result = await service.handleDomainEvent(
      'finance.transaction.created',
      'Transaction',
      payload,
    );

    expect(result.success).toBe(true);
    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0].action).toBe('finance.transaction.created');
    expect(repository.logs[0].entityName).toBe('Transaction');
    expect(repository.logs[0].entityId).toBe('tx-999');
    expect(repository.logs[0].tenantId).toBe(tenantA);
  });

  it('garantiza que la interfaz y el servicio son estrictamente append-only sin update ni delete', () => {
    // Comprobación arquitectónica de inmutabilidad en la API de servicio y repositorio
    expect((service as any).updateLog).toBeUndefined();
    expect((service as any).deleteLog).toBeUndefined();
    expect((service as any).removeLog).toBeUndefined();
    expect((repository as any).updateLog).toBeUndefined();
    expect((repository as any).deleteLog).toBeUndefined();
    expect((repository as any).removeLog).toBeUndefined();
  });
});
