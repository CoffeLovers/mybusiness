import { describe, expect, it, vi } from 'vitest';
import { PayPalOrderStatus } from '@mybusiness/contracts';
import {
  PayPalWebhookProcessEventStatus,
  PaymentsRepository,
} from '../src/payments/payments.repository';
import type { FinanceDatabaseService } from '../src/database/database.service';
import type { PayPalOrder, PayPalRefund, PayPalWebhookEvent } from '../src/database/schema';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function orderRow(overrides: Partial<PayPalOrder> = {}): PayPalOrder {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    invoiceId: INVOICE_ID,
    status: 'CREATED',
    amountMinor: 2500n,
    currency: 'USD',
    paypalOrderId: 'PAYPAL-123',
    idempotencyKey: 'idem-1',
    checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123',
    providerResponse: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function refundRow(overrides: Partial<PayPalRefund> = {}): PayPalRefund {
  return {
    id: 'r-1',
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    captureId: 'CAPTURE-1',
    paypalRefundId: 'REFUND-1',
    amountMinor: 1000n,
    currency: 'USD',
    reason: 'Servicio no prestado',
    requestedBy: 'user-1',
    providerStatus: 'COMPLETED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function webhookEventRow(overrides: Partial<PayPalWebhookEvent> = {}): PayPalWebhookEvent {
  return {
    id: 'ev-1',
    eventId: 'WH-1',
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    resourceId: 'CAPTURE-1',
    order: ORDER_ID,
    payload: {},
    processingStatus: 'RECEIVED',
    errorMessage: null,
    processedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface FakeChain {
  whereArgs: unknown[];
  setArgs: unknown[];
  valuesArgs: unknown[];
  conflictTargets: unknown[];
  selectResults: unknown[];
  insertResult: unknown;
  updateResult: unknown;
}

/**
 * Cadena fluida Drizzle simulada que cubre los tres shapes del repositorio:
 * `select()…where().limit()`, `insert()…values().onConflictDoNothing().returning()`
 * y `update()…set().where().returning()`.
 */
function fakeDb(
  options: {
    selectResults?: unknown[];
    insertResult?: unknown;
    updateResult?: unknown;
  } = {},
): { db: Record<string, unknown>; chain: FakeChain } {
  const chain: FakeChain = {
    whereArgs: [],
    setArgs: [],
    valuesArgs: [],
    conflictTargets: [],
    selectResults: options.selectResults ?? [],
    insertResult: options.insertResult ?? undefined,
    updateResult: options.updateResult ?? undefined,
  };

  const selectLimit = vi.fn().mockImplementation(async () => chain.selectResults.shift() ?? []);
  const selectWhere = vi.fn((predicate: unknown) => {
    chain.whereArgs.push(predicate);
    return { limit: selectLimit };
  });
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn().mockImplementation(async () => chain.insertResult);
  const onConflictDoNothing = vi.fn((target: unknown) => {
    chain.conflictTargets.push(target);
    return { returning: insertReturning };
  });
  const values = vi.fn((record: unknown) => {
    chain.valuesArgs.push(record);
    return { onConflictDoNothing };
  });
  const insert = vi.fn(() => ({ values }));

  const updateReturning = vi.fn().mockImplementation(async () => chain.updateResult);
  const updateWhere = vi.fn((predicate: unknown) => {
    chain.whereArgs.push(predicate);
    return { returning: updateReturning };
  });
  const set = vi.fn((patch: unknown) => {
    chain.setArgs.push(patch);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set }));

  return { db: { select, insert, update }, chain };
}

function repositoryOf(db: Record<string, unknown>): PaymentsRepository {
  return new PaymentsRepository({ db } as unknown as FinanceDatabaseService);
}

describe('PaymentsRepository (SF3-09)', () => {
  it('findOrderById filtra por tenant', async () => {
    const { db, chain } = fakeDb({ selectResults: [[orderRow()]] });
    const result = await repositoryOf(db).findOrderById(TENANT_ID, ORDER_ID);

    expect(result?.id).toBe(ORDER_ID);
    expect(chain.whereArgs.length).toBe(1);
  });

  it('findOrderByPaypalOrderId resuelve la orden por id del proveedor', async () => {
    const { db, chain } = fakeDb({ selectResults: [[orderRow()]] });

    const result = await repositoryOf(db).findOrderByPaypalOrderId('PAYPAL-123');

    expect(result).not.toBeNull();
    expect(chain.whereArgs.length).toBe(1);
  });

  it('el webhook resuelve por custom_id con techo de 2 órdenes (ambigüedad)', async () => {
    const matches = [orderRow(), orderRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })];
    const { db, chain } = fakeDb({ selectResults: [matches] });

    const result = await repositoryOf(db).findOrdersByIdempotencyKey('idem-1');

    expect(result.length).toBe(2);
    expect(chain.whereArgs.length).toBe(1);
  });

  it('findOrdersByInvoiceId devuelve el fallback por factura', async () => {
    const { db } = fakeDb({ selectResults: [[orderRow()]] });

    expect(await repositoryOf(db).findOrdersByInvoiceId(INVOICE_ID)).toHaveLength(1);
  });

  it('markOrderCaptured transita con estados de origen y guarda capture-id (condicional)', async () => {
    const claimed = orderRow({
      status: 'CAPTURED',
      captureId: 'CAPTURE-1',
      capturedAmountMinor: 2500n,
    });
    const { db, chain } = fakeDb({ updateResult: [claimed] });

    const result = await repositoryOf(db).markOrderCaptured({
      orderId: ORDER_ID,
      fromStatuses: [PayPalOrderStatus.CREATED, PayPalOrderStatus.APPROVED],
      captureId: 'CAPTURE-1',
      capturedAmountMinor: 2500n,
    });

    expect(result?.status).toBe('CAPTURED');
    expect(chain.setArgs[0]).toEqual(
      expect.objectContaining({
        status: 'CAPTURED',
        captureId: 'CAPTURE-1',
        capturedAmountMinor: 2500n,
      }),
    );
  });

  it('markOrderCaptured sin filas devuelve null (transición perdida ante carrera)', async () => {
    const { db } = fakeDb({ updateResult: [] });

    const result = await repositoryOf(db).markOrderCaptured({
      orderId: ORDER_ID,
      fromStatuses: [PayPalOrderStatus.APPROVED],
      captureId: 'C',
      capturedAmountMinor: 1n,
    });

    expect(result).toBeNull();
  });

  it('markOrderApproved y markInvoicePaid son updates condicionales idempotentes', async () => {
    const approved = fakeDb({ updateResult: [orderRow({ status: 'APPROVED' })] });
    await repositoryOf(approved.db).markOrderApproved({
      orderId: ORDER_ID,
      fromStatuses: [PayPalOrderStatus.CREATED],
    });
    expect(approved.chain.setArgs[0]).toEqual(expect.objectContaining({ status: 'APPROVED' }));

    const paid = fakeDb({ updateResult: [{ id: INVOICE_ID, status: 'PAID' }] });
    await repositoryOf(paid.db).markInvoicePaid(TENANT_ID, INVOICE_ID);
    expect(paid.chain.setArgs[0]).toEqual(expect.objectContaining({ status: 'PAID' }));
  });

  it('applyRefundToOrder acumula y promociona al estado final explicit', async () => {
    const accumulated = orderRow({ status: 'CAPTURED', refundedAmountMinor: 1000n });
    const { db, chain } = fakeDb({ updateResult: [accumulated] });

    const result = await repositoryOf(db).applyRefundToOrder({
      orderId: ORDER_ID,
      refundedAmountMinor: 1000n,
      finalStatus: PayPalOrderStatus.CAPTURED,
    });

    expect(result?.refundedAmountMinor).toBe(1000n);
    expect(chain.setArgs[0]).toEqual(expect.objectContaining({ status: 'CAPTURED' }));
    // El claim exige estados expresados como predicado WHERE.
    expect(chain.whereArgs.length).toBe(1);
  });

  it('createRefund inserta idempotente por paypal_refund_id y resuelve carreras', async () => {
    const record = {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      captureId: 'CAPTURE-1',
      paypalRefundId: 'REFUND-1',
      amountMinor: 1000n,
      currency: 'USD',
      reason: 'Servicio no prestado',
      requestedBy: 'user-1',
      providerStatus: 'COMPLETED',
    };

    const fresh = fakeDb({ insertResult: [refundRow()] });
    const freshResult = await repositoryOf(fresh.db).createRefund(record);
    expect(freshResult.created).toBe(true);
    expect(freshResult.refund.paypalRefundId).toBe('REFUND-1');

    const race = fakeDb({ insertResult: [] });
    // El re-read tras conflicto reusa select: registro previo devuelto.
    race.chain.selectResults.push([refundRow()]);
    const raceResult = await repositoryOf(race.db).createRefund(record);
    expect(raceResult.created).toBe(false);
    expect(raceResult.refund.id).toBe('r-1');
  });

  it('createRefund sin fila resoluble tras conflicto lanza error explícito', async () => {
    const { db } = fakeDb({ insertResult: [] });
    // El re-read tampoco encuentra la fila: imposible en producción, error tipado.
    const repository = repositoryOf(db);
    const promise = repository.createRefund({
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      captureId: 'CAPTURE-1',
      paypalRefundId: 'REFUND-9',
      amountMinor: 1n,
      currency: 'USD',
      reason: 'x',
      requestedBy: 'u',
      providerStatus: 'COMPLETED',
    });

    await expect(promise).rejects.toThrow('No se pudo resolver el reembolso idempotente');
  });

  it('findRefundByPaypalRefundId localiza el reembolso conocido', async () => {
    const { db, chain } = fakeDb({ selectResults: [[refundRow()]] });

    const result = await repositoryOf(db).findRefundByPaypalRefundId('REFUND-1');

    expect(result?.paypalRefundId).toBe('REFUND-1');
    expect(chain.whereArgs.length).toBe(1);
  });

  it('createWebhookEvent reserva el event_id y resuelve la carrera con null', async () => {
    const insertOk = fakeDb({ insertResult: [webhookEventRow()] });
    const created = await repositoryOf(insertOk.db).createWebhookEvent({
      eventId: 'WH-1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      resourceId: 'CAPTURE-1',
      payload: { id: 'WH-1' },
    });
    expect(created?.eventId).toBe('WH-1');
    expect(insertOk.chain.valuesArgs[0]).toEqual(
      expect.objectContaining({
        eventId: 'WH-1',
        processingStatus: PayPalWebhookProcessEventStatus.RECEIVED,
      }),
    );

    const insertRace = fakeDb({ insertResult: [] });
    const raced = await repositoryOf(insertRace.db).createWebhookEvent({
      eventId: 'WH-1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      payload: {},
    });
    expect(raced).toBeNull();
  });

  it('findWebhookEventByEventId y markWebhookEvent actualizan el ciclo de procesado', async () => {
    const found = fakeDb({ selectResults: [[webhookEventRow()]] });
    const event = await repositoryOf(found.db).findWebhookEventByEventId('WH-1');
    expect(event?.eventId).toBe('WH-1');

    const marked = fakeDb();
    await repositoryOf(marked.db).markWebhookEvent(
      'WH-1',
      PayPalWebhookProcessEventStatus.PROCESSED,
      undefined,
    );
    expect(marked.chain.setArgs[0]).toEqual(
      expect.objectContaining({ processingStatus: 'PROCESSED', errorMessage: null }),
    );

    let threw = false;
    try {
      await repositoryOf(marked.db).markWebhookEvent(
        'WH-1',
        'BOGUS' as PayPalWebhookProcessEventStatus,
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
