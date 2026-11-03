import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import {
  AuditEvents,
  LedgerReconciliationStatus,
  LedgerSortField,
  UserRole,
  type RequestContext,
} from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../src/database/database.service';
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  documents,
  ledgerSavedViews,
  reconciliationMatches,
} from '../src/database/schema';
import { LedgerService, MAX_BULK } from '../src/ledger/ledger.service';
import type { DomainEventPublisher } from '../src/events/domain-event.publisher';

const databaseUrl = process.env.FINANCE_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

type TxType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

interface TxSeed {
  name: string;
  merchantName: string | null;
  category: string[] | null;
  amountMinor: bigint;
  date: string;
  type: TxType;
}

interface SeededTransaction {
  id: string;
  name: string;
}

interface RecordedEvent {
  pattern: string;
  payload: Record<string, unknown>;
}

/** Doble del publisher que acumula `(pattern, payload)` sin tocar el bus. */
class RecordingPublisher {
  readonly events: RecordedEvent[] = [];

  async publish(pattern: string, payload: object): Promise<void> {
    this.events.push({ pattern, payload: payload as Record<string, unknown> });
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Datos deterministas del tenant A.
 * 25 movimientos con fechas 2026-01-01..2026-01-25, montos crecientes 1000..25000
 * y nombres por defecto `Movimiento NN`. Los índices con override cubren los
 * casos de filtros, orden y neutralización CSV.
 */
const TENANT_A_OVERRIDES = new Map<number, Partial<TxSeed>>([
  [
    3,
    {
      name: 'Pago nómina',
      merchantName: 'ACME S.A.S.',
      category: ['Nómina'],
      type: 'EXPENSE',
    },
  ],
  [4, { name: 'Transferencia ahorro', category: ['Ahorro'], type: 'TRANSFER' }],
  [5, { name: '=SUM(A1:A2)', category: ['Servicios'], type: 'EXPENSE' }],
  [6, { name: 'Factura conciliada', category: ['Ventas'], type: 'INCOME' }],
  [7, { name: 'Factura por revisar', category: ['Ventas'], type: 'EXPENSE' }],
  [
    8,
    {
      name: 'Compra menor',
      merchantName: 'Tienda Central',
      category: ['Compras'],
      type: 'EXPENSE',
    },
  ],
  [10, { category: ['Ventas'] }],
  [11, { category: ['Ventas'] }],
]);

function buildTenantATransactions(): TxSeed[] {
  return Array.from({ length: 25 }, (_, index) => {
    const base: TxSeed = {
      name: `Movimiento ${String(index).padStart(2, '0')}`,
      merchantName: null,
      category: null,
      amountMinor: BigInt((index + 1) * 1000),
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      type: 'INCOME',
    };

    const override = TENANT_A_OVERRIDES.get(index);
    return override ? { ...base, ...override } : base;
  });
}

describeIfDb('LedgerService (integración PostgreSQL)', () => {
  let database: FinanceDatabaseService;
  let publisher: RecordingPublisher;
  let service: LedgerService;

  const userId = randomUUID();
  const otherUserId = randomUUID();
  const tenantIds: string[] = [];
  const connectionIds: string[] = [];
  const accountIds: string[] = [];
  const documentIds: string[] = [];
  const matchIds: string[] = [];

  let tenantA: string;
  let tenantB: string;
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let txA: SeededTransaction[];
  let txB: SeededTransaction[];

  function newTenant(): string {
    const tenantId = randomUUID();
    tenantIds.push(tenantId);
    return tenantId;
  }

  function contextFor(tenantId: string, id: string = userId): RequestContext {
    return { tenantId, userId: id, role: UserRole.ACCOUNTANT };
  }

  async function createConnection(tenantId: string): Promise<string> {
    const [row] = await database.db
      .insert(bankConnections)
      .values({
        userId,
        tenantId,
        provider: 'plaid',
        providerItemId: `item-${randomUUID()}`,
        accessTokenCiphertext: 'ciphertext-de-prueba',
      })
      .returning({ id: bankConnections.id });

    connectionIds.push(row.id);
    return row.id;
  }

  async function createAccount(
    tenantId: string,
    connectionId: string,
    suffix: string,
  ): Promise<string> {
    const [row] = await database.db
      .insert(bankAccounts)
      .values({
        tenantId,
        connectionId,
        providerAccountId: `acc-${randomUUID()}`,
        institutionName: 'Banco de Pruebas',
        name: `Cuenta ${suffix}`,
        accountNumberMasked: `****${suffix}`,
        currency: 'COP',
        isoCurrencyCode: 'COP',
      })
      .returning({ id: bankAccounts.id });

    accountIds.push(row.id);
    return row.id;
  }

  async function insertTransactions(
    accountIdsForTenant: string[],
    connectionId: string,
    rows: TxSeed[],
  ): Promise<SeededTransaction[]> {
    return database.db
      .insert(bankTransactions)
      .values(
        rows.map((tx, index) => ({
          accountId: accountIdsForTenant[index % accountIdsForTenant.length],
          connectionId,
          providerTransactionId: `tx-${randomUUID()}`,
          amountMinor: tx.amountMinor,
          transactionType: tx.type,
          isoCurrencyCode: 'COP',
          date: tx.date,
          name: tx.name,
          merchantName: tx.merchantName,
          category: tx.category,
        })),
      )
      .returning({ id: bankTransactions.id, name: bankTransactions.name });
  }

  async function createDocument(tenantId: string, originalName: string): Promise<string> {
    const [row] = await database.db
      .insert(documents)
      .values({
        tenantId,
        userId,
        originalName,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksumSha256: randomUUID(),
        storageKey: `${tenantId}/${randomUUID()}.pdf`,
      })
      .returning({ id: documents.id });

    documentIds.push(row.id);
    return row.id;
  }

  async function createMatch(input: {
    tenantId: string;
    bankTransactionId: string;
    documentId: string;
    status: 'AUTO_MATCHED' | 'NEEDS_REVIEW';
    score: string;
  }): Promise<void> {
    const [row] = await database.db
      .insert(reconciliationMatches)
      .values({
        tenantId: input.tenantId,
        bankTransactionId: input.bankTransactionId,
        documentId: input.documentId,
        status: input.status,
        score: input.score,
        rule: 'amount_date_window',
        evidence: { fixture: true },
        matchedAt: new Date('2026-02-01T00:00:00.000Z'),
      })
      .returning({ id: reconciliationMatches.id });

    matchIds.push(row.id);
  }

  function idOf(rows: SeededTransaction[], name: string): string {
    const found = rows.find((row) => row.name === name);
    if (!found) {
      throw new Error(`No se encontró la transacción sembrada "${name}"`);
    }
    return found.id;
  }

  beforeAll(async () => {
    database = new FinanceDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);

    publisher = new RecordingPublisher();
    service = new LedgerService(database, publisher as unknown as DomainEventPublisher);

    tenantA = newTenant();
    tenantB = newTenant();
    ctxA = contextFor(tenantA);
    ctxB = contextFor(tenantB);

    // Tenant A: dos cuentas COP, 25 movimientos y conciliaciones.
    const connectionA = await createConnection(tenantA);
    const accountA1 = await createAccount(tenantA, connectionA, '0001');
    const accountA2 = await createAccount(tenantA, connectionA, '0002');

    const seededA = buildTenantATransactions();
    txA = await insertTransactions([accountA1, accountA2], connectionA, seededA);

    const autoDoc = await createDocument(tenantA, 'factura-auto.pdf');
    const reviewDoc = await createDocument(tenantA, 'factura-revision.pdf');

    await createMatch({
      tenantId: tenantA,
      bankTransactionId: idOf(txA, 'Factura conciliada'),
      documentId: autoDoc,
      status: 'AUTO_MATCHED',
      score: '0.900',
    });
    await createMatch({
      tenantId: tenantA,
      bankTransactionId: idOf(txA, 'Factura por revisar'),
      documentId: reviewDoc,
      status: 'NEEDS_REVIEW',
      score: '0.700',
    });

    // Tenant B: cadena completa propia para probar aislamiento.
    const connectionB = await createConnection(tenantB);
    const accountB1 = await createAccount(tenantB, connectionB, '1001');
    const accountB2 = await createAccount(tenantB, connectionB, '1002');

    txB = await insertTransactions([accountB1, accountB2], connectionB, [
      {
        name: 'Movimiento B uno',
        merchantName: null,
        category: ['Ventas'],
        amountMinor: 500n,
        date: '2026-01-10',
        type: 'INCOME',
      },
      {
        name: 'Movimiento B dos',
        merchantName: 'Proveedor B',
        category: null,
        amountMinor: 750n,
        date: '2026-01-11',
        type: 'EXPENSE',
      },
      {
        name: 'Movimiento B tres',
        merchantName: null,
        category: null,
        amountMinor: 1250n,
        date: '2026-01-12',
        type: 'INCOME',
      },
    ]);
  });

  beforeEach(() => {
    publisher.clear();
  });

  afterAll(async () => {
    if (matchIds.length > 0) {
      await database.db
        .delete(reconciliationMatches)
        .where(inArray(reconciliationMatches.id, matchIds));
    }
    if (documentIds.length > 0) {
      await database.db.delete(documents).where(inArray(documents.id, documentIds));
    }
    if (accountIds.length > 0) {
      await database.db
        .delete(bankTransactions)
        .where(inArray(bankTransactions.accountId, accountIds));
    }
    if (tenantIds.length > 0) {
      await database.db
        .delete(ledgerSavedViews)
        .where(inArray(ledgerSavedViews.tenantId, tenantIds));
    }
    if (accountIds.length > 0) {
      await database.db.delete(bankAccounts).where(inArray(bankAccounts.id, accountIds));
    }
    if (connectionIds.length > 0) {
      await database.db.delete(bankConnections).where(inArray(bankConnections.id, connectionIds));
    }

    await database.onModuleDestroy();
  });

  // ---------------------------------------------------------------------------
  // a. Paginación y orden por defecto
  // ---------------------------------------------------------------------------

  it('pagina de 10 en 10, informa hasMore/total y ordena por fecha descendente', async () => {
    const page1 = await service.list(ctxA, { pageSize: 10 });

    expect(page1.rows).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(10);
    expect(page1.hasMore).toBe(true);

    const dates = page1.rows.map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(page1.rows[0].date).toBe('2026-01-25');

    const page2 = await service.list(ctxA, { page: 2, pageSize: 10 });
    expect(page2.rows).toHaveLength(10);
    expect(page2.hasMore).toBe(true);

    const page3 = await service.list(ctxA, { page: 3, pageSize: 10 });
    expect(page3.rows).toHaveLength(5);
    expect(page3.hasMore).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // b. Orden por monto y nombre + default sin sortBy
  // ---------------------------------------------------------------------------

  it('ordena por monto ascendente y por nombre ascendente', async () => {
    const byAmount = await service.list(ctxA, {
      sortBy: LedgerSortField.AMOUNT,
      sortDir: 'asc',
      pageSize: 200,
    });

    expect(byAmount.rows).toHaveLength(25);
    expect(byAmount.rows[0].amountMinor).toBe('1000');
    expect(byAmount.rows[24].amountMinor).toBe('25000');

    const byName = await service.list(ctxA, {
      sortBy: LedgerSortField.NAME,
      sortDir: 'asc',
      pageSize: 200,
    });

    const names = byName.rows.map((row) => row.name);
    expect(names).toHaveLength(25);
    expect(names[0]).toBe('Compra menor');
    expect(names[24]).toBe('Transferencia ahorro');
    expect(names.indexOf('Pago nómina')).toBeGreaterThan(names.indexOf('Movimiento 24'));
  });

  it('sin sortBy no rompe y aplica fecha descendente por defecto', async () => {
    const page = await service.list(ctxA, { pageSize: 200 });

    expect(page.total).toBe(25);
    const dates = page.rows.map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  // ---------------------------------------------------------------------------
  // c. Filtros
  // ---------------------------------------------------------------------------

  it('filtra por nombre y por contraparte con q', async () => {
    const byName = await service.list(ctxA, { q: 'Pago nómina', pageSize: 200 });
    expect(byName.total).toBe(1);
    expect(byName.rows[0].name).toBe('Pago nómina');

    const byMerchant = await service.list(ctxA, { q: 'Tienda Central', pageSize: 200 });
    expect(byMerchant.total).toBe(1);
    expect(byMerchant.rows[0].merchantName).toBe('Tienda Central');
    expect(byMerchant.rows[0].name).toBe('Compra menor');
  });

  it('filtra por categoría y por rango de fechas', async () => {
    const byCategory = await service.list(ctxA, { category: 'Ventas', pageSize: 200 });
    expect(byCategory.total).toBe(4);
    expect(byCategory.rows.every((row) => row.category === 'Ventas')).toBe(true);

    const byRange = await service.list(ctxA, {
      from: '2026-01-05',
      to: '2026-01-09',
      pageSize: 200,
    });
    expect(byRange.total).toBe(5);
    expect(byRange.rows.map((row) => row.date).sort()).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
    ]);
  });

  // ---------------------------------------------------------------------------
  // d. Estado de conciliación
  // ---------------------------------------------------------------------------

  it('UNMATCHED excluye las transacciones conciliadas', async () => {
    const unmatched = await service.list(ctxA, {
      reconciliationStatus: LedgerReconciliationStatus.UNMATCHED,
      pageSize: 200,
    });

    expect(unmatched.total).toBe(23);
    expect(unmatched.rows.every((row) => row.reconciliationStatus === 'UNMATCHED')).toBe(true);
    expect(unmatched.rows.map((row) => row.name)).not.toContain('Factura conciliada');
  });

  it('AUTO_MATCHED devuelve la fila con evidencia del documento', async () => {
    const autoMatched = await service.list(ctxA, {
      reconciliationStatus: LedgerReconciliationStatus.AUTO_MATCHED,
      pageSize: 200,
    });

    expect(autoMatched.total).toBe(1);
    const [row] = autoMatched.rows;
    expect(row.name).toBe('Factura conciliada');
    expect(row.reconciliationStatus).toBe(LedgerReconciliationStatus.AUTO_MATCHED);
    expect(row.evidence?.documentName).toBe('factura-auto.pdf');
    expect(row.evidence?.score).toBe(0.9);
  });

  // ---------------------------------------------------------------------------
  // e. Aislamiento por tenant
  // ---------------------------------------------------------------------------

  it('aísla listado y exportación entre tenants', async () => {
    const listA = await service.list(ctxA, { pageSize: 200 });
    const listB = await service.list(ctxB, { pageSize: 200 });

    expect(listA.total).toBe(25);
    expect(listB.total).toBe(3);

    const idsB = new Set(txB.map((row) => row.id));
    expect(listA.rows.some((row) => idsB.has(row.id))).toBe(false);
    expect(listB.rows.every((row) => row.name.startsWith('Movimiento B'))).toBe(true);

    const csvB = await service.exportCsv(ctxB, {});
    expect(csvB.rowCount).toBe(3);
    expect(csvB.content).not.toContain('Factura conciliada');
  });

  // ---------------------------------------------------------------------------
  // f. Exportación CSV
  // ---------------------------------------------------------------------------

  it('exporta CSV con cabecera exacta, respeta filtros y neutraliza fórmulas', async () => {
    const full = await service.exportCsv(ctxA, {});

    expect(full.contentType).toBe('text/csv; charset=utf-8');
    expect(full.rowCount).toBe(25);
    expect(full.filename).toMatch(/^libro-mayor-\d{8}\.csv$/);
    expect(full.content.startsWith('\uFEFF')).toBe(true);

    const lines = full.content.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(
      'fecha,descripcion,contraparte,categoria,monto,moneda,estado_conciliacion,evidencia',
    );
    expect(full.content).toContain("'=SUM(A1:A2)");
    expect(full.content).toContain('factura-auto.pdf');

    const filtered = await service.exportCsv(ctxA, { category: 'Compras' });
    expect(filtered.rowCount).toBe(1);
    expect(filtered.content).toContain('Compra menor');
    expect(filtered.content).not.toContain('Pago nómina');
  });

  // ---------------------------------------------------------------------------
  // g. Edición manual
  // ---------------------------------------------------------------------------

  it('actualiza categoría y notas, guarda el array y publica auditoría', async () => {
    const targetId = txA[0].id;

    const updated = await service.update(ctxA, targetId, {
      category: 'Marketing',
      notes: 'Revisado por contabilidad',
    });

    expect(updated.id).toBe(targetId);
    expect(updated.category).toBe('Marketing');
    expect(updated.notes).toBe('Revisado por contabilidad');

    const [raw] = await database.db
      .select({ category: bankTransactions.category, notes: bankTransactions.notes })
      .from(bankTransactions)
      .where(eq(bankTransactions.id, targetId));

    expect(raw.category).toEqual(['Marketing']);
    expect(raw.notes).toBe('Revisado por contabilidad');

    expect(publisher.events).toHaveLength(1);
    const event = publisher.events[0];
    expect(event.pattern).toBe(AuditEvents.LOG_EVENT);
    expect(event.payload).toMatchObject({
      action: 'ledger.transaction.updated',
      entityId: targetId,
      oldValues: { category: null, notes: null },
      newValues: { category: ['Marketing'], notes: 'Revisado por contabilidad' },
      tenantId: tenantA,
      userId,
    });
  });

  it('rechaza actualizar una transacción de otro tenant y una edición vacía', async () => {
    await expect(service.update(ctxA, txB[0].id, { category: 'Marketing' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await expect(service.update(ctxA, txA[1].id, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(publisher.events).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // h. Categorización masiva
  // ---------------------------------------------------------------------------

  it('categoriza en lote sólo las transacciones del tenant y publica un evento', async () => {
    const ids = [txA[20].id, txA[21].id, txA[22].id, txB[0].id];

    const result = await service.bulkCategorize(ctxA, { ids, category: 'Operativo' });

    expect(result).toEqual({ updated: 3, requested: 4 });
    expect(publisher.events).toHaveLength(1);

    const event = publisher.events[0];
    expect(event.pattern).toBe(AuditEvents.LOG_EVENT);
    expect(event.payload).toMatchObject({
      action: 'ledger.transactions.bulk_categorized',
    });

    const bulkValues = event.payload.newValues as { ids: string[]; category: string };
    expect([...bulkValues.ids].sort()).toEqual([txA[20].id, txA[21].id, txA[22].id].sort());
    expect(bulkValues.category).toBe('Operativo');

    const [otherTenantRow] = await database.db
      .select({ category: bankTransactions.category })
      .from(bankTransactions)
      .where(eq(bankTransactions.id, txB[0].id));
    expect(otherTenantRow.category).toEqual(['Ventas']);
  });

  it('rechaza más de MAX_BULK ids sin tocar la base de datos', async () => {
    const ids = Array.from({ length: MAX_BULK + 1 }, () => randomUUID());

    await expect(
      service.bulkCategorize(ctxA, { ids, category: 'Operativo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(publisher.events).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // i. Vistas guardadas
  // ---------------------------------------------------------------------------

  it('crea, lista, re-crea y aísla las vistas guardadas por usuario y tenant', async () => {
    const beta = await service.createSavedView(ctxA, { name: 'Beta', query: { q: 'beta' } });
    const alfa = await service.createSavedView(ctxA, { name: 'Alfa', query: { q: 'alfa' } });

    expect(alfa.id).toBeDefined();
    expect(beta.id).not.toBe(alfa.id);

    const views = await service.listSavedViews(ctxA);
    expect(views.map((view) => view.name)).toEqual(['Alfa', 'Beta']);
    expect(views[0].query.q).toBe('alfa');

    const recreated = await service.createSavedView(ctxA, {
      name: 'Alfa',
      query: { category: 'Ventas' },
    });
    expect(recreated.id).toBe(alfa.id);
    expect(recreated.query.category).toBe('Ventas');

    const afterRecreate = await service.listSavedViews(ctxA);
    expect(afterRecreate).toHaveLength(2);

    // Otro usuario del mismo tenant no ve ni puede borrar las vistas ajenas.
    const ctxOtherUser = contextFor(tenantA, otherUserId);
    await service.createSavedView(ctxOtherUser, { name: 'Otra', query: { q: 'otra' } });

    const viewsA = await service.listSavedViews(ctxA);
    expect(viewsA.map((view) => view.name)).toEqual(['Alfa', 'Beta']);

    await expect(service.deleteSavedView(ctxOtherUser, beta.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.deleteSavedView(ctxB, beta.id)).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.deleteSavedView(ctxA, beta.id)).resolves.toEqual({ deleted: true });
  });
});
