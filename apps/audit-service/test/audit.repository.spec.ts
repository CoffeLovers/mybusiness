import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditRepository } from '../src/audit.repository';
import type { AuditDatabaseService } from '../src/database/database.service';
import type { AuditDeadLetter, AuditLog, NewAuditLog } from '../src/database/schema';

type MockFn = ReturnType<typeof vi.fn>;

interface MockDatabase {
  insert: MockFn;
  values: MockFn;
  onConflictDoNothing: MockFn;
  returning: MockFn;
  select: MockFn;
  from: MockFn;
  where: MockFn;
  limit: MockFn;
}

/**
 * Mock encadenable de Drizzle que soporta:
 * - insert().values().onConflictDoNothing().returning()
 * - insert().values().returning()
 * - select().from().where().limit()
 */
function createMockDatabase(): MockDatabase {
  const db = {
    insert: vi.fn(),
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning: vi.fn<() => Promise<unknown[]>>(),
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn<() => Promise<unknown[]>>(),
  };

  const chainable = [db.insert, db.values, db.onConflictDoNothing, db.select, db.from, db.where];
  for (const fn of chainable) {
    fn.mockReturnValue(db);
  }

  return db;
}

describe('AuditRepository (Append-Only & Idempotencia)', () => {
  let db: MockDatabase;
  let repository: AuditRepository;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  const buildRow = (overrides: Partial<AuditLog> = {}): AuditLog => ({
    id: 'log-1',
    tenantId,
    eventId: 'evt-1',
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

  const buildEntry = (overrides: Partial<NewAuditLog> = {}): NewAuditLog & { eventId: string } => ({
    tenantId,
    eventId: 'evt-1',
    action: 'auth.login',
    entityName: 'User',
    entityId: 'usr-1',
    newValues: { status: 'SUCCESS' },
    ...overrides,
  });

  beforeEach(() => {
    db = createMockDatabase();
    repository = new AuditRepository({ db } as unknown as AuditDatabaseService);
  });

  it('insertLogIdempotent retorna { created: true, log } cuando la fila se inserta', async () => {
    const row = buildRow();
    const entry = buildEntry();
    db.returning.mockResolvedValueOnce([row]);

    const result = await repository.insertLogIdempotent(entry);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(entry);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.returning).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: true, log: row });
    expect(db.limit).not.toHaveBeenCalled();
  });

  it('insertLogIdempotent retorna { created: false, log } con el registro existente en reentrega', async () => {
    const existing = buildRow({ id: 'log-existing' });
    db.returning.mockResolvedValueOnce([]);
    db.limit.mockResolvedValueOnce([existing]);

    const result = await repository.insertLogIdempotent(buildEntry());

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual({ created: false, log: existing });
  });

  it('insertLogIdempotent lanza Error si no inserta y tampoco encuentra el registro previo', async () => {
    db.returning.mockResolvedValueOnce([]);
    db.limit.mockResolvedValueOnce([]);

    await expect(repository.insertLogIdempotent(buildEntry())).rejects.toThrow(Error);
  });

  it('findByEventId retorna la fila encontrada', async () => {
    const row = buildRow({ eventId: 'evt-found' });
    db.limit.mockResolvedValueOnce([row]);

    const result = await repository.findByEventId(tenantId, 'evt-found');

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(row);
  });

  it('findByEventId retorna null cuando no existe el registro', async () => {
    db.limit.mockResolvedValueOnce([]);

    const result = await repository.findByEventId(tenantId, 'evt-missing');

    expect(result).toBeNull();
  });

  it('quarantine inserta en audit_dead_letters y retorna la fila persistida', async () => {
    const deadLetter: AuditDeadLetter = {
      id: 'dlq-1',
      tenantId,
      eventType: 'audit.log_event',
      payload: { eventId: 'evt-1' },
      error: 'DB failure',
      attempts: 3,
      failedAt: new Date('2026-10-30T00:00:00.000Z'),
    };
    const entry = {
      tenantId,
      eventType: 'audit.log_event',
      payload: { eventId: 'evt-1' },
      error: 'DB failure',
      attempts: 3,
    };
    db.returning.mockResolvedValueOnce([deadLetter]);

    const result = await repository.quarantine(entry);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(entry);
    expect(result).toEqual(deadLetter);
  });

  it('no expone métodos update ni delete (append-only estricto)', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repository));
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('updateLog');
    expect(methods).not.toContain('deleteLog');
    expect(methods).not.toContain('remove');
  });
});
