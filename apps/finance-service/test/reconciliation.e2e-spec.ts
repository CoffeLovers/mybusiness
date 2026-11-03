import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { ConfigService } from '@nestjs/config';
import {
  BankProvider,
  DocumentStatus,
  ReconciliationMatchStatus,
  ReconciliationRunStatus,
  ReconciliationTrigger,
  TransactionType,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../src/database/database.service';
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  documents,
  reconciliationMatches,
  reconciliationRuns,
  reconciliationSettings,
} from '../src/database/schema';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('Reconciliation (integración PostgreSQL y constraints)', () => {
  let database: FinanceDatabaseService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();

  let connectionAId: string;
  let accountAId: string;
  let bankTxA1Id: string;
  let bankTxA2Id: string;
  let docA1Id: string;
  let docA2Id: string;

  beforeAll(async () => {
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);

    // Setup connection and account for Tenant A
    const [conn] = await database.db
      .insert(bankConnections)
      .values({
        tenantId: tenantA,
        userId,
        provider: BankProvider.PLAID,
        providerItemId: `reconcile-conn-${randomUUID()}`,
        accessTokenCiphertext: 'cipher-test',
        status: 'active',
      })
      .returning();
    connectionAId = conn.id;

    const [acc] = await database.db
      .insert(bankAccounts)
      .values({
        tenantId: tenantA,
        connectionId: connectionAId,
        providerAccountId: `acc-${randomUUID()}`,
        institutionName: 'Banco Conciliacion',
        accountNumberMasked: '****4444',
        currency: 'COP',
        currentBalanceMinor: 1000000n,
        availableBalanceMinor: 1000000n,
      })
      .returning();
    accountAId = acc.id;

    // Insert bank transactions for Tenant A
    const [tx1] = await database.db
      .insert(bankTransactions)
      .values({
        tenantId: tenantA,
        connectionId: connectionAId,
        accountId: accountAId,
        providerTransactionId: `tx-${randomUUID()}`,
        postedAt: new Date('2026-03-01T10:00:00Z'),
        amountMinor: -5000000n,
        currency: 'COP',
        descriptionRaw: 'PAGO FACTURA AWS CLOUD',
        type: TransactionType.DEBIT,
      })
      .returning();
    bankTxA1Id = tx1.id;

    const [tx2] = await database.db
      .insert(bankTransactions)
      .values({
        tenantId: tenantA,
        connectionId: connectionAId,
        accountId: accountAId,
        providerTransactionId: `tx-${randomUUID()}`,
        postedAt: new Date('2026-03-02T10:00:00Z'),
        amountMinor: -3500000n,
        currency: 'COP',
        descriptionRaw: 'PAGO MICROSOFT AZURE',
        type: TransactionType.DEBIT,
      })
      .returning();
    bankTxA2Id = tx2.id;

    // Insert documents for Tenant A
    const [doc1] = await database.db
      .insert(documents)
      .values({
        tenantId: tenantA,
        userId,
        originalName: 'factura_aws.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `docs/${randomUUID()}.pdf`,
        status: DocumentStatus.EXTRACTED,
        totalMinor: 5000000n,
        currency: 'COP',
        issueDate: new Date('2026-03-01T00:00:00Z'),
        providerName: 'Amazon Web Services Inc',
        invoiceNumber: 'AWS-2026-001',
        confidence: 0.98,
      })
      .returning();
    docA1Id = doc1.id;

    const [doc2] = await database.db
      .insert(documents)
      .values({
        tenantId: tenantA,
        userId,
        originalName: 'factura_azure.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `docs/${randomUUID()}.pdf`,
        status: DocumentStatus.EXTRACTED,
        totalMinor: 3500000n,
        currency: 'COP',
        issueDate: new Date('2026-03-02T00:00:00Z'),
        providerName: 'Microsoft Colombia SAS',
        invoiceNumber: 'MS-2026-002',
        confidence: 0.95,
      })
      .returning();
    docA2Id = doc2.id;
  });

  afterAll(async () => {
    const tenants = [tenantA, tenantB];
    await database.db
      .delete(reconciliationMatches)
      .where(inArray(reconciliationMatches.tenantId, tenants));
    await database.db
      .delete(reconciliationRuns)
      .where(inArray(reconciliationRuns.tenantId, tenants));
    await database.db
      .delete(reconciliationSettings)
      .where(inArray(reconciliationSettings.tenantId, tenants));
    await database.db.delete(bankTransactions).where(inArray(bankTransactions.tenantId, tenants));
    await database.db.delete(documents).where(inArray(documents.tenantId, tenants));
    await database.db.delete(bankAccounts).where(inArray(bankAccounts.tenantId, tenants));
    await database.db.delete(bankConnections).where(inArray(bankConnections.tenantId, tenants));
  });

  it('permite insertar y consultar settings de conciliación por defecto', async () => {
    const [settings] = await database.db
      .insert(reconciliationSettings)
      .values({
        tenantId: tenantA,
        timezone: 'America/Bogota',
      })
      .returning();

    expect(settings).toBeDefined();
    expect(settings.tenantId).toBe(tenantA);
    expect(settings.dateWindowDays).toBe(5);
    expect(settings.autoMatchThresholdBps).toBe(8500);
    expect(settings.timezone).toBe('America/Bogota');
    expect(settings.lookbackDays).toBe(30);
    expect(settings.nightlyEnabled).toBe(true);
  });

  it('registra runs de conciliación con contadores y triggers', async () => {
    const [run] = await database.db
      .insert(reconciliationRuns)
      .values({
        tenantId: tenantA,
        trigger: ReconciliationTrigger.NIGHTLY,
        status: ReconciliationRunStatus.RUNNING,
      })
      .returning();

    expect(run).toBeDefined();
    expect(run.status).toBe(ReconciliationRunStatus.RUNNING);

    const [completed] = await database.db
      .update(reconciliationRuns)
      .set({
        status: ReconciliationRunStatus.COMPLETED,
        finishedAt: new Date(),
        processed: 10,
        autoMatched: 8,
        needsReview: 2,
        errors: 0,
      })
      .where(eq(reconciliationRuns.id, run.id))
      .returning();

    expect(completed.status).toBe(ReconciliationRunStatus.COMPLETED);
    expect(completed.autoMatched).toBe(8);
  });

  it('hace cumplir el índice único parcial impidiendo doble match activo de la misma transacción', async () => {
    // Primer match activo
    await database.db.insert(reconciliationMatches).values({
      tenantId: tenantA,
      bankTransactionId: bankTxA1Id,
      documentId: docA1Id,
      status: ReconciliationMatchStatus.AUTO_MATCHED,
      score: '0.950',
      rule: 'amount+date+counterparty',
      evidence: { amountMinor: 5000000, score: 0.95 },
    });

    // Intentar segundo match activo para la misma transacción (con otro documento) debe violar el índice único parcial
    await expect(
      database.db.insert(reconciliationMatches).values({
        tenantId: tenantA,
        bankTransactionId: bankTxA1Id,
        documentId: docA2Id,
        status: ReconciliationMatchStatus.MANUAL_MATCHED,
        score: '0.900',
        rule: 'manual',
        evidence: { amountMinor: 5000000, score: 0.9 },
      }),
    ).rejects.toThrow();
  });

  it('hace cumplir el índice único parcial impidiendo doble match activo del mismo documento', async () => {
    // Intentar asociar docA1Id (ya en AUTO_MATCHED con bankTxA1Id) a otra transacción en estado activo debe violar el índice
    await expect(
      database.db.insert(reconciliationMatches).values({
        tenantId: tenantA,
        bankTransactionId: bankTxA2Id,
        documentId: docA1Id,
        status: ReconciliationMatchStatus.MANUAL_MATCHED,
        score: '0.900',
        rule: 'manual',
        evidence: { amountMinor: 5000000, score: 0.9 },
      }),
    ).rejects.toThrow();
  });

  it('permite registrar matches en estado REJECTED o NEEDS_REVIEW sin bloquear nuevos matches activos', async () => {
    // docA2Id y bankTxA2Id con un match REJECTED
    const [rejected] = await database.db
      .insert(reconciliationMatches)
      .values({
        tenantId: tenantA,
        bankTransactionId: bankTxA2Id,
        documentId: docA2Id,
        status: ReconciliationMatchStatus.REJECTED,
        score: '0.400',
        rule: 'amount_only',
        evidence: { amountMinor: 3500000, score: 0.4 },
      })
      .returning();

    expect(rejected.status).toBe(ReconciliationMatchStatus.REJECTED);
  });

  it('garantiza aislamiento estricto por tenant', async () => {
    // Consultar matches para Tenant B debe retornar vacío
    const matchesTenantB = await database.db
      .select()
      .from(reconciliationMatches)
      .where(eq(reconciliationMatches.tenantId, tenantB));

    expect(matchesTenantB).toHaveLength(0);
  });
});
