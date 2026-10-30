import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditRepository } from '../src/audit.repository';
import type { AuditDatabaseService } from '../src/database/database.service';
import type { AuditLog, NewAuditLog } from '../src/database/schema';

function createMockDatabase() {
  const db: Record<string, unknown> = {};
  const passthrough = () => vi.fn<(...args: unknown[]) => Record<string, unknown>>(() => db);
  const limit = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const returning = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

  const select = passthrough();
  const from = passthrough();
  const where = passthrough();
  const insert = passthrough();
  const values = passthrough();

  Object.assign(db, {
    select,
    from,
    where,
    limit,
    insert,
    values,
    returning,
  });

  return {
    db,
    select,
    from,
    where,
    limit,
    insert,
    values,
    returning,
  };
}

describe('AuditRepository (Append-Only Persistencia)', () => {
  let builder: ReturnType<typeof createMockDatabase>;
  let repository: AuditRepository;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    builder = createMockDatabase();
    const dbService = { db: builder.db } as unknown as AuditDatabaseService;
    repository = new AuditRepository(dbService);
  });

  it('insertLog ejecuta INSERT y retorna el registro creado', async () => {
    const entry: NewAuditLog = {
      tenantId,
      action: 'auth.login',
      entityName: 'User',
      entityId: 'usr-1',
      oldValues: null,
      newValues: { status: 'SUCCESS' },
    };

    const mockRow: AuditLog = {
      id: 'log-1',
      tenantId,
      userId: null,
      action: 'auth.login',
      entityName: 'User',
      entityId: 'usr-1',
      oldValues: null,
      newValues: { status: 'SUCCESS' },
      ipAddress: null,
      userAgent: null,
      timestamp: new Date(),
    };

    builder.returning.mockResolvedValueOnce([mockRow]);

    const result = await repository.insertLog(entry);

    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.values).toHaveBeenCalledWith(entry);
    expect(builder.returning).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockRow);
  });

  it('findByEventId consulta el registro por tenant y eventId con limit 1', async () => {
    const mockRow: AuditLog = {
      id: 'log-2',
      tenantId,
      userId: null,
      action: 'finance.transaction.created',
      entityName: 'Transaction',
      entityId: 'tx-1',
      oldValues: null,
      newValues: { eventId: 'evt-1' },
      ipAddress: null,
      userAgent: null,
      timestamp: new Date(),
    };

    builder.limit.mockResolvedValueOnce([mockRow]);

    const result = await repository.findByEventId(tenantId, 'evt-1');

    expect(builder.select).toHaveBeenCalledTimes(1);
    expect(builder.from).toHaveBeenCalledTimes(1);
    expect(builder.where).toHaveBeenCalledTimes(1);
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(mockRow);
  });

  it('findByEventId retorna null cuando no encuentra ningún registro', async () => {
    builder.limit.mockResolvedValueOnce([]);

    const result = await repository.findByEventId(tenantId, 'evt-non-existent');

    expect(result).toBeNull();
  });

  it('cumple política estricta de append-only: no existen métodos update o delete', () => {
    expect((repository as any).update).toBeUndefined();
    expect((repository as any).updateLog).toBeUndefined();
    expect((repository as any).delete).toBeUndefined();
    expect((repository as any).deleteLog).toBeUndefined();
    expect((repository as any).remove).toBeUndefined();
  });
});
