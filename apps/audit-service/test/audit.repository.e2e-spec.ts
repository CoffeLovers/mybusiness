import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditRepository } from '../src/audit.repository';
import { AuditDatabaseService } from '../src/database/database.service';
import { auditDeadLetters } from '../src/database/schema';

const databaseUrl = process.env.AUDIT_DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

function collectErrorMessages(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as { message?: unknown; cause?: unknown };
    if (typeof candidate.message === 'string') messages.push(candidate.message);
    current = candidate.cause;
  }

  return messages.join(' | ');
}

describeIf('AuditRepository (integración PostgreSQL)', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let database: AuditDatabaseService;
  let repository: AuditRepository;

  beforeAll(() => {
    database = new AuditDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    repository = new AuditRepository(database);
  });

  beforeEach(async () => {
    await database.db.delete(auditDeadLetters).where(eq(auditDeadLetters.tenantId, tenantA));
    await database.db.delete(auditDeadLetters).where(eq(auditDeadLetters.tenantId, tenantB));
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('inserta y trata como idempotente la reentrega del mismo (tenantId, eventId)', async () => {
    const eventId = randomUUID();
    const entry = {
      tenantId: tenantA,
      eventId,
      action: 'finance.transaction.created',
      entityName: 'transaction',
      entityId: randomUUID(),
    };

    const first = await repository.insertLogIdempotent(entry);
    const second = await repository.insertLogIdempotent(entry);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.log.id).toBe(first.log.id);
  });

  it('permite el mismo eventId en otro tenant', async () => {
    const eventId = randomUUID();
    const base = {
      eventId,
      action: 'finance.invoice.paid',
      entityName: 'invoice',
      entityId: randomUUID(),
    };

    const first = await repository.insertLogIdempotent({ ...base, tenantId: tenantA });
    const second = await repository.insertLogIdempotent({ ...base, tenantId: tenantB });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.log.id).not.toBe(first.log.id);
  });

  it('rechaza UPDATE sobre audit_logs mediante trigger append-only', async () => {
    const eventId = randomUUID();
    await repository.insertLogIdempotent({
      tenantId: tenantA,
      eventId,
      action: 'security.read',
      entityName: 'audit',
    });

    let error: unknown;
    try {
      await database.db.execute(
        sql`UPDATE audit_logs SET action = 'hacked' WHERE tenant_id = ${tenantA}`,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(collectErrorMessages(error)).toMatch(/immutable|append-only/i);
  });

  it('rechaza DELETE sobre audit_logs mediante trigger append-only', async () => {
    const eventId = randomUUID();
    await repository.insertLogIdempotent({
      tenantId: tenantA,
      eventId,
      action: 'security.read',
      entityName: 'audit',
    });

    let error: unknown;
    try {
      await database.db.execute(sql`DELETE FROM audit_logs WHERE tenant_id = ${tenantA}`);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(collectErrorMessages(error)).toMatch(/immutable|append-only/i);
  });

  it('rechaza TRUNCATE sobre audit_logs mediante trigger de protección', async () => {
    let error: unknown;
    try {
      await database.db.execute(sql`TRUNCATE TABLE audit_logs`);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(collectErrorMessages(error)).toMatch(/immutable|append-only/i);
  });

  it('persiste la cuarentena y la expone por tenant', async () => {
    const record = await repository.quarantine({
      tenantId: tenantA,
      eventType: 'finance.transaction.created',
      payload: { eventId: randomUUID() },
      error: 'fallo simulado tras reintentos',
      attempts: 3,
    });

    const found = await database.db
      .select()
      .from(auditDeadLetters)
      .where(eq(auditDeadLetters.tenantId, tenantA));

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(record.id);
  });
});
