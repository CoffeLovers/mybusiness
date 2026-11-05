import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditEvents,
  PaymentEvents,
  PayPalOrderStatus,
  UserRole,
  type CapturePayPalOrderDto,
  type RefundPayPalOrderDto,
  type RequestContext,
} from '@mybusiness/contracts';
import { PayPalPaymentService } from '../src/payments/paypal-payment.service';
import { PayPalWebhookService } from '../src/payments/paypal-webhook.service';
import { PayPalOrdersController } from '../src/payments/payments.controller';
import {
  mapPayPalErrorToHttpException,
  paymentOrderNotFound,
  toPayPalRefundView,
} from '../src/payments/paypal-support';
import {
  PayPalTransitionError,
  requirePayPalTransition,
  isPayPalTransitionAllowed,
  PAYPAL_ORDER_TRANSITIONS,
} from '../src/payments/paypal-state-machine';
import { PayPalClient, PayPalClientError } from '../src/payments/paypal-client';
import type { PaymentsRepository } from '../src/payments/payments.repository';
import type { DomainEventPublisher } from '../src/events/domain-event.publisher';
import type { PayPalOrder } from '../src/database/schema';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ctxA: RequestContext = { tenantId: TENANT_A, userId: 'user-1', role: UserRole.ACCOUNTANT };

function orderRow(overrides: Partial<PayPalOrder> = {}): PayPalOrder {
  return {
    id: ORDER_ID,
    tenantId: TENANT_A,
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

function fullRepo(overrides: Record<string, unknown> = {}): PaymentsRepository {
  const base = {
    findOrderById: vi.fn().mockResolvedValue(orderRow()),
    findOrderByPaypalOrderId: vi.fn().mockResolvedValue(null),
    findOrdersByIdempotencyKey: vi.fn().mockResolvedValue([]),
    findOrdersByInvoiceId: vi.fn().mockResolvedValue([]),
    markOrderCaptured: vi
      .fn()
      .mockResolvedValue(
        orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1', capturedAmountMinor: 2500n }),
      ),
    markOrderApproved: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    markInvoicePaid: vi.fn().mockResolvedValue(null),
    findRefundByPaypalRefundId: vi.fn().mockResolvedValue(null),
    createRefund: vi
      .fn()
      .mockImplementation((record: Record<string, unknown>) =>
        Promise.resolve({ created: true, refund: { id: 'r-1', ...record, createdAt: new Date() } }),
      ),
    applyRefundToOrder: vi.fn().mockResolvedValue(orderRow({ status: 'REFUNDED' })),
    findWebhookEventByEventId: vi.fn().mockResolvedValue(null),
    createWebhookEvent: vi.fn().mockResolvedValue({ id: 'ev-1' }),
    markWebhookEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaymentsRepository;
  return Object.assign(base, overrides) as PaymentsRepository;
}

function config(): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'PAYPAL_RETRY_MAX_ATTEMPTS') return 3;
      if (key === 'PAYPAL_RETRY_BASE_DELAY_MS') return 1;
      return fallback;
    }),
  } as unknown as ConfigService;
}

interface PaymentHarness {
  service: PayPalPaymentService;
  repository: Record<string, ReturnType<typeof vi.fn>>;
  client: { captureOrder: ReturnType<typeof vi.fn>; refundCapture: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn> };
}

function paymentHarness(overrides: Record<string, unknown> = {}): PaymentHarness {
  const repository = fullRepo(overrides);
  const client = {
    captureOrder: vi.fn().mockResolvedValue({
      orderId: 'PAYPAL-123',
      status: 'COMPLETED',
      captureId: 'CAPTURE-1',
      captureStatus: 'COMPLETED',
      raw: {},
    }),
    refundCapture: vi
      .fn()
      .mockResolvedValue({ refundId: 'REFUND-1', status: 'COMPLETED', raw: {} }),
  };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };
  const service = new PayPalPaymentService(
    repository,
    client as unknown as PayPalClient,
    events as unknown as DomainEventPublisher,
    config(),
  );
  return { service, repository, client, events };
}

function errorOf(action: () => Promise<unknown>): Promise<unknown> {
  return action().catch((error: unknown) => error);
}

// ─── Máquina de estados ──────────────────────────────────────────────────────

describe('Máquina de estados PayPal (SF3-09)', () => {
  it('declara sólo transiciones legítimas y rechaza las inválidas', () => {
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.CREATED]).toContain(
      PayPalOrderStatus.APPROVED,
    );
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.CREATED]).toContain(
      PayPalOrderStatus.CAPTURED,
    );
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.APPROVED]).toEqual([
      PayPalOrderStatus.CAPTURED,
      PayPalOrderStatus.FAILED,
    ]);
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.CAPTURED]).toEqual([
      PayPalOrderStatus.REFUNDED,
    ]);
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.REFUNDED]).toEqual([]);
    expect(PAYPAL_ORDER_TRANSITIONS[PayPalOrderStatus.FAILED]).toEqual([]);
  });

  it('reembolsar una orden no capturada lanza el error tipado', () => {
    expect(() =>
      requirePayPalTransition(PayPalOrderStatus.APPROVED, PayPalOrderStatus.REFUNDED),
    ).toThrow(PayPalTransitionError);

    try {
      requirePayPalTransition(PayPalOrderStatus.APPROVED, PayPalOrderStatus.REFUNDED);
    } catch (error) {
      expect((error as PayPalTransitionError).code).toBe('PAYMENT_INVALID_TRANSITION');
    }
  });

  it('permite todas las transiciones declaradas del mapa', () => {
    for (const [from, targets] of Object.entries(PAYPAL_ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(isPayPalTransitionAllowed(from as PayPalOrderStatus, to)).toBe(true);
      }
    }
    // Y rechaza las no declaradas (created → refunded, etc.).
    expect(isPayPalTransitionAllowed(PayPalOrderStatus.CREATED, PayPalOrderStatus.REFUNDED)).toBe(
      false,
    );
  });
});

// ─── Captura / Reembolso (servicio) ──────────────────────────────────────────

describe('PayPalPaymentService.captura (SF3-09)', () => {
  let harness: PaymentHarness;

  beforeEach(() => {
    harness = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    });
  });

  it('captura el total desde APPROVED, concilia la factura y publica evento + auditoría', async () => {
    const view = await harness.service.capture(ctxA, ORDER_ID, {});

    expect(harness.client.captureOrder).toHaveBeenCalledWith('PAYPAL-123', 'idem-1');
    expect(harness.repository.markOrderCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        captureId: 'CAPTURE-1',
        capturedAmountMinor: 2500n,
      }),
    );
    expect(harness.repository.markInvoicePaid).toHaveBeenCalledWith(TENANT_A, INVOICE_ID);
    expect(view.status).toBe(PayPalOrderStatus.CAPTURED);
    expect(view.captureId).toBe('CAPTURE-1');

    const patterns = harness.events.publish.mock.calls.map((call: unknown[]) => call[0]);
    expect(patterns).toContain(PaymentEvents.PAYPAL_CAPTURED);
    expect(patterns).toContain(AuditEvents.LOG_EVENT);
  });

  it('registra la captura parcial sin llamar dos veces al proveedor', async () => {
    const dto: CapturePayPalOrderDto = { amountMinor: '1000' };
    const view = await harness.service.capture(ctxA, ORDER_ID, dto);

    expect(harness.client.captureOrder).toHaveBeenCalledTimes(1);
    expect(harness.repository.markOrderCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAmountMinor: 1000n }),
    );
    expect(view.amountMinor).toBe('2500');
  });

  it('rechaza con PAYMENT_INVALID_AMOUNT un parcial mayor al total', async () => {
    const error = await errorOf(() =>
      harness.service.capture(ctxA, ORDER_ID, { amountMinor: '99000' }),
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(((error as HttpException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INVALID_AMOUNT',
    );
    expect(harness.client.captureOrder).not.toHaveBeenCalled();
  });

  it('rechaza con 409 PAYMENT_INVALID_TRANSITION una orden no aprobada', async () => {
    const failing = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'REFUNDED' })),
    });

    const error = await errorOf(() => failing.service.capture(ctxA, ORDER_ID, {}));

    expect(error).toBeInstanceOf(ConflictException);
    expect(((error as ConflictException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INVALID_TRANSITION',
    );
    expect(failing.client.captureOrder).not.toHaveBeenCalled();
  });

  it('reintenta fallos transitorios con backoff y termina en CAPTURED', async () => {
    harness.client.captureOrder
      .mockRejectedValueOnce(new PayPalClientError('PAYPAL_NETWORK', 'no se pudo contactar'))
      .mockRejectedValueOnce(new PayPalClientError('PAYPAL_TIMEOUT', 'no respondió'))
      .mockResolvedValue({
        orderId: 'PAYPAL-123',
        status: 'COMPLETED',
        captureId: 'CAPTURE-1',
        captureStatus: 'COMPLETED',
        raw: {},
      });

    const view = await harness.service.capture(ctxA, ORDER_ID, {});

    expect(harness.client.captureOrder).toHaveBeenCalledTimes(3);
    expect(view.status).toBe(PayPalOrderStatus.CAPTURED);
  });

  it('propaga 502 con código estable tras agotar reintentos, sin mutar la orden', async () => {
    harness.client.captureOrder.mockRejectedValue(
      new PayPalClientError('PAYPAL_RATE_LIMITED', 'llegó al límite'),
    );

    const error = await errorOf(() => harness.service.capture(ctxA, ORDER_ID, {}));

    expect(harness.client.captureOrder).toHaveBeenCalledTimes(3);
    expect((error as ConflictException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(((error as ConflictException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_PROVIDER_RATE_LIMITED',
    );
    expect(harness.repository.markOrderCaptured).not.toHaveBeenCalled();
  });
});

describe('PayPalPaymentService.reembolso (SF3-09)', () => {
  let harness: PaymentHarness;

  beforeEach(() => {
    harness = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(
        orderRow({
          status: 'CAPTURED',
          captureId: 'CAPTURE-1',
          capturedAmountMinor: 2500n,
          refundedAmountMinor: null,
        }),
      ),
    });
  });

  it('reembolsa el total, promueve a REFUNDED y audita motivo + actor', async () => {
    const view = await harness.service.refund(ctxA, ORDER_ID, { reason: 'Servicio no prestado' });

    expect(harness.client.refundCapture).toHaveBeenCalledWith(
      expect.objectContaining({ captureId: 'CAPTURE-1', reason: 'Servicio no prestado' }),
    );
    expect(harness.repository.applyRefundToOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        refundedAmountMinor: 2500n,
        finalStatus: PayPalOrderStatus.REFUNDED,
      }),
    );
    expect(view.paypalRefundId).toBe('REFUND-1');

    const refundedEvent = harness.events.publish.mock.calls.find(
      (call: unknown[]) => call[0] === PaymentEvents.PAYPAL_REFUNDED,
    );
    expect(refundedEvent?.[1]).toMatchObject({
      reason: 'Servicio no prestado',
      userId: 'user-1',
    });
    const auditCall = harness.events.publish.mock.calls.find(
      (call: unknown[]) =>
        call[0] === AuditEvents.LOG_EVENT &&
        (call[1] as { action?: string }).action === PaymentEvents.PAYPAL_REFUNDED,
    );
    expect(auditCall?.[1]).toMatchObject({
      newValues: { reason: 'Servicio no prestado', requestedBy: 'user-1' },
    });
  });

  it('reembolso parcial mantiene CAPTURED y acumula el importe', async () => {
    harness.repository.applyRefundToOrder.mockResolvedValue(
      orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1', refundedAmountMinor: 1000n }),
    );

    await harness.service.refund(ctxA, ORDER_ID, {
      reason: 'Descuento comercial',
      amountMinor: '1000',
    });

    expect(harness.client.refundCapture).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: '1000' }),
    );
    expect(harness.repository.applyRefundToOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        refundedAmountMinor: 1000n,
        finalStatus: PayPalOrderStatus.CAPTURED,
      }),
    );
  });

  it('rechaza con 409 reembolsar una orden no capturada', async () => {
    const failing = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    });

    const error = await errorOf(() =>
      failing.service.refund(ctxA, ORDER_ID, { reason: 'Servicio duplicado' }),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(((error as ConflictException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INVALID_TRANSITION',
    );
    expect(failing.client.refundCapture).not.toHaveBeenCalled();
  });

  it('exige motivo obligatorio', async () => {
    await expect(harness.service.refund(ctxA, ORDER_ID, { reason: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      (
        harness.service.refund as unknown as (
          c: RequestContext,
          o: string,
          d: RefundPayPalOrderDto,
        ) => Promise<unknown>
      )(ctxA, ORDER_ID, { reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.client.refundCapture).not.toHaveBeenCalled();
  });

  it('reentra idempotente si el webhook ya registró el mismo reembolso', async () => {
    harness.repository.createRefund.mockResolvedValue({
      created: false,
      refund: {
        id: 'r-0',
        tenantId: TENANT_A,
        orderId: ORDER_ID,
        paypalRefundId: 'REFUND-1',
        captureId: 'CAPTURE-1',
        amountMinor: 2500n,
        currency: 'USD',
        reason: 'Servicio duplicado',
        requestedBy: 'system:paypal-webhook',
        createdAt: new Date(),
      },
    });

    const view = await harness.service.refund(ctxA, ORDER_ID, { reason: 'Duplicado' });

    expect(view.paypalRefundId).toBe('REFUND-1');
    expect(harness.repository.applyRefundToOrder).not.toHaveBeenCalled();
    expect(harness.events.publish).not.toHaveBeenCalled();
  });
});

// ─── Webhooks firmados (SF3-09) ──────────────────────────────────────────────

describe('PayPalWebhookService (SF3-09)', () => {
  const RAW_BODY = JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' });
  const HEADERS = {
    'paypal-transmission-id': 't-1',
    'paypal-transmission-time': '2026-01-01T00:00:00Z',
    'paypal-cert-url': 'https://cert.paypal.com/1',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'sig',
  };

  function webhookHarness(overrides: Record<string, unknown> = {}) {
    const paymentService = {
      reconcileCapture: vi.fn().mockResolvedValue(undefined),
      reconcileRefund: vi.fn().mockResolvedValue(undefined),
    };
    const repository = fullRepo({
      findOrdersByIdempotencyKey: vi.fn().mockResolvedValue([orderRow({ status: 'APPROVED' })]),
      ...overrides,
    });
    const client = {
      verifyWebhookSignature: vi.fn().mockResolvedValue({ verified: true }),
    };
    const service = new PayPalWebhookService(
      repository,
      client as unknown as PayPalClient,
      paymentService as unknown as PayPalPaymentService,
    );
    return { service, repository, client, paymentService };
  }

  it('fail-closed: firma inválida responde 401 y no toca la base de datos', async () => {
    const h = webhookHarness();
    h.client.verifyWebhookSignature.mockResolvedValue({
      verified: false,
      reason: 'signature_invalid',
    });

    const error = await errorOf(() => h.service.handleWebhook({}, HEADERS, RAW_BODY));

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(((error as UnauthorizedException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    );
    expect(h.repository.createWebhookEvent).not.toHaveBeenCalled();
  });

  it('fail-closed: sin webhook_id configurado responde 401', async () => {
    const h = webhookHarness();
    h.client.verifyWebhookSignature.mockResolvedValue({
      verified: false,
      reason: 'webhook_id_not_configured',
    });

    const error = await errorOf(() => h.service.handleWebhook({}, HEADERS, RAW_BODY));

    expect((error as UnauthorizedException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(h.repository.createWebhookEvent).not.toHaveBeenCalled();
  });

  it('deduplica por event_id: duplicado responde 200 sin reprocesar', async () => {
    const h = webhookHarness({
      findWebhookEventByEventId: vi
        .fn()
        .mockResolvedValue({ id: 'ev-0', processingStatus: 'PROCESSED' }),
    });

    const result = await h.service.handleWebhook(
      { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'already_processed', eventId: 'WH-1' });
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
    expect(h.repository.createWebhookEvent).not.toHaveBeenCalled();
  });

  it('registra la carrera como already_processed si otra réplica ganó la inserción', async () => {
    const h = webhookHarness({ createWebhookEvent: vi.fn().mockResolvedValue(null) });

    const result = await h.service.handleWebhook(
      { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('already_processed');
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
    expect(h.repository.markWebhookEvent).not.toHaveBeenCalled();
  });

  it('convierte el importe decimal a minor y concilia la captura (ADR 003)', async () => {
    const h = webhookHarness();

    const result = await h.service.handleWebhook(
      {
        id: 'WH-2',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-9',
          amount: { value: '25.00', currency_code: 'USD' },
          custom_id: 'idem-1',
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'processed', eventId: 'WH-2' });
    expect(h.paymentService.reconcileCapture).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID, status: 'APPROVED' }),
      'CAPTURE-9',
      2500n,
    );
    expect(h.repository.markWebhookEvent).toHaveBeenCalledWith('WH-2', 'PROCESSED', undefined);
  });

  it('double-capture: orden ya CAPTURED reentra idempotente sin reprocesar', async () => {
    const h = webhookHarness({
      findOrdersByIdempotencyKey: vi
        .fn()
        .mockResolvedValue([orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1' })]),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-3',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-1',
          amount: { value: '25.00', currency_code: 'USD' },
          custom_id: 'idem-1',
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('processed');
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
  });

  it('CHECKOUT.ORDER.APPROVED transita CREATED → APPROVED', async () => {
    const h = webhookHarness({
      findOrderByPaypalOrderId: vi.fn().mockResolvedValue(orderRow({ status: 'CREATED' })),
    });

    const result = await h.service.handleWebhook(
      { id: 'WH-4', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'PAYPAL-123' } },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('processed');
    expect(h.repository.markOrderApproved).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      fromStatuses: [PayPalOrderStatus.CREATED],
    });
  });

  it('un APPROVED sobre orden FAILED se ignora (transición inválida)', async () => {
    const h = webhookHarness({
      findOrderByPaypalOrderId: vi.fn().mockResolvedValue(orderRow({ status: 'FAILED' })),
    });

    const result = await h.service.handleWebhook(
      { id: 'WH-5', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'PAYPAL-123' } },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'ignored', reason: 'transicion_invalida' });
    expect(h.repository.markOrderApproved).not.toHaveBeenCalled();
  });

  it('PAYMENT.CAPTURE.REFUNDED no reejecuta reembolsos ya registrados por el endpoint', async () => {
    const h = webhookHarness({
      findOrdersByIdempotencyKey: vi
        .fn()
        .mockResolvedValue([orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1' })]),
      findRefundByPaypalRefundId: vi.fn().mockResolvedValue({ id: 'r-9' }),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-6',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'REFUND-1',
          capture_id: 'CAPTURE-1',
          custom_id: 'idem-1',
          amount: { value: '10.00', currency_code: 'USD' },
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('processed');
    expect(h.paymentService.reconcileRefund).not.toHaveBeenCalled();
  });

  it('reembolso nuevo vía webhook registra motivo y actor del webhook', async () => {
    const h = webhookHarness({
      findOrdersByIdempotencyKey: vi
        .fn()
        .mockResolvedValue([orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1' })]),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-7',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'REFUND-2',
          capture_id: 'CAPTURE-1',
          custom_id: 'idem-1',
          amount: { value: '25.00', currency_code: 'USD' },
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('processed');
    expect(h.paymentService.reconcileRefund).toHaveBeenCalledWith(
      expect.anything(),
      'CAPTURE-1',
      'REFUND-2',
      2500n,
    );
  });

  it('rechaza 400 un evento sin id/event_type y no escribe nada', async () => {
    const h = webhookHarness();

    const error = await errorOf(() => h.service.handleWebhook({ foo: 1 }, HEADERS, RAW_BODY));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(((error as BadRequestException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_WEBHOOK_EVENT_INVALID',
    );
    expect(h.repository.createWebhookEvent).not.toHaveBeenCalled();
  });

  it('un evento FAILED se resetea atómicamente en la redelivery y se reprocesa', async () => {
    const h = webhookHarness({
      // Fila previa en FAILED: la reserva (upsert condicionado) la reabre y
      // devuelve la fila reseteada (contrato atómico del repositorio).
      findWebhookEventByEventId: vi
        .fn()
        .mockResolvedValue({ id: 'ev-2', processingStatus: 'FAILED' }),
      createWebhookEvent: vi
        .fn()
        .mockResolvedValue({ id: 'ev-2', processingStatus: 'RECEIVED', processedAt: null }),
      findOrdersByIdempotencyKey: vi.fn().mockResolvedValue([orderRow({ status: 'APPROVED' })]),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-8',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-5',
          amount: { value: '25.00', currency_code: 'USD' },
          custom_id: 'idem-1',
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result.status).toBe('processed');
    // La reserva resetea a RECEIVED y el reproceso cierra en PROCESSED.
    expect(h.repository.createWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'WH-8', resourceId: 'CAPTURE-5' }),
    );
    expect(h.paymentService.reconcileCapture).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID }),
      'CAPTURE-5',
      2500n,
    );
    expect(h.repository.markWebhookEvent).toHaveBeenCalledWith('WH-8', 'PROCESSED', undefined);
  });

  it('la redelivery concurrente de un FAILED no se reprocesa dos veces entre réplicas', async () => {
    const h = webhookHarness({
      findWebhookEventByEventId: vi
        .fn()
        .mockResolvedValue({ id: 'ev-2', processingStatus: 'FAILED' }),
      // Otra réplica ya ganó el reset (upsert devuelve 0 filas): no reprocesar.
      createWebhookEvent: vi.fn().mockResolvedValue(null),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-8',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-5',
          amount: { value: '25.00', currency_code: 'USD' },
          custom_id: 'idem-1',
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'already_processed', eventId: 'WH-8' });
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
    expect(h.repository.markWebhookEvent).not.toHaveBeenCalled();
  });

  it('un evento ya PROCESSED es idempotente: el upsert no lo resetea ni lo reprocesa', async () => {
    const h = webhookHarness({
      // El conflicto resultó en ninguna fila: el estado vigente no era FAILED.
      createWebhookEvent: vi.fn().mockResolvedValue(null),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-3',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-1',
          amount: { value: '25.00', currency_code: 'USD' },
          custom_id: 'idem-1',
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'already_processed', eventId: 'WH-3' });
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
    expect(h.repository.markWebhookEvent).not.toHaveBeenCalled();
  });

  it('un evento desconocido se registra como ignored con motivo', async () => {
    const h = webhookHarness();

    const result = await h.service.handleWebhook(
      { id: 'WH-9', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { id: 'R1' } },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'ignored', reason: 'evento_no_accionable' });
    expect(h.repository.markWebhookEvent).toHaveBeenCalledWith(
      'WH-9',
      'IGNORED',
      'evento_no_accionable',
    );
  });

  it('un webhook cuyo custom_id es ambiguo entre tenants arriba a ignored', async () => {
    const h = webhookHarness({
      findOrdersByIdempotencyKey: vi
        .fn()
        .mockResolvedValue([
          orderRow({ status: 'APPROVED', tenantId: TENANT_B }),
          orderRow({ status: 'APPROVED' }),
        ]),
    });

    const result = await h.service.handleWebhook(
      {
        id: 'WH-10',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'C-1',
          custom_id: 'idem-1',
          amount: { value: '25.00', currency_code: 'USD' },
        },
      },
      HEADERS,
      RAW_BODY,
    );

    expect(result).toMatchObject({ status: 'ignored', reason: 'orden_no_resuelta' });
    expect(h.paymentService.reconcileCapture).not.toHaveBeenCalled();
  });
});

// ─── Reconciliación webhook → servicio (con real PayPalPaymentService) ───────

describe('PayPalPaymentService reconciliación de webhooks (SF3-09)', () => {
  it('reconcileCapture marca CAPTURED, concilia la factura y publica eventos una sola vez', async () => {
    const h = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    });

    await h.service.reconcileCapture(
      {
        id: ORDER_ID,
        tenantId: TENANT_A,
        invoiceId: INVOICE_ID,
        paypalOrderId: 'PAYPAL-123',
        currency: 'USD',
        amountMinor: 2500n,
      },
      'CAPTURE-9',
      2500n,
    );

    expect(h.repository.markOrderCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ captureId: 'CAPTURE-9', capturedAmountMinor: 2500n }),
    );
    expect(h.repository.markInvoicePaid).toHaveBeenCalledWith(TENANT_A, INVOICE_ID);
    expect(h.events.publish).toHaveBeenCalledWith(
      PaymentEvents.PAYPAL_CAPTURED,
      expect.objectContaining({ captureId: 'CAPTURE-9', amountMinor: '2500' }),
    );
  });

  it('reconcileCapture ajusta el importe del proveedor mayor al de la orden, advierte y audita la divergencia', async () => {
    const h = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    });
    const logger = (h.service as unknown as { logger: Logger }).logger;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await h.service.reconcileCapture(
      {
        id: ORDER_ID,
        tenantId: TENANT_A,
        invoiceId: INVOICE_ID,
        paypalOrderId: 'PAYPAL-123',
        currency: 'USD',
        amountMinor: 2500n,
      },
      'CAPTURE-9',
      3000n,
    );

    // Clamp: se concilia con el importe de la orden, no el del proveedor.
    expect(h.repository.markOrderCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAmountMinor: 2500n, captureId: 'CAPTURE-9' }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Divergencia en la captura'));
    // Divergencia auditable junto a la captura conciliada.
    expect(h.events.publish).toHaveBeenCalledWith(
      AuditEvents.LOG_EVENT,
      expect.objectContaining({
        action: PaymentEvents.PAYPAL_CAPTURED,
        entityId: ORDER_ID,
        newValues: expect.objectContaining({
          captureId: 'CAPTURE-9',
          providerAmountMinor: '3000',
          orderAmountMinor: '2500',
          reconciledAmountMinor: '2500',
          divergence: 'provider_amount_exceeds_order_amount',
        }),
      }),
    );
  });

  it('reconcileCapture es reentrante: si ya está CAPTURED no republish', async () => {
    const h = paymentHarness({
      findOrderById: vi
        .fn()
        .mockResolvedValue(orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1' })),
      markOrderCaptured: vi.fn().mockResolvedValue(null),
    });

    await h.service.reconcileCapture(
      {
        id: ORDER_ID,
        tenantId: TENANT_A,
        invoiceId: INVOICE_ID,
        paypalOrderId: 'PAYPAL-123',
        currency: 'USD',
        amountMinor: 2500n,
      },
      'CAPTURE-1',
      2500n,
    );

    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('reconcileRefund acumula hasta REFUNDED con actor del webhook y audita motivo', async () => {
    const h = paymentHarness({
      findOrderById: vi
        .fn()
        .mockResolvedValue(orderRow({ status: 'CAPTURED', captureId: 'CAPTURE-1' })),
    });

    await h.service.reconcileRefund(
      {
        id: ORDER_ID,
        tenantId: TENANT_A,
        captureId: 'CAPTURE-1',
        amountMinor: 2500n,
        capturedAmountMinor: 2500n,
        refundedAmountMinor: null,
        currency: 'USD',
      },
      'CAPTURE-1',
      'REFUND-9',
      2500n,
    );

    expect(h.repository.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedBy: 'system:paypal-webhook',
        reason: 'Notificación del proveedor',
      }),
    );
    expect(h.repository.applyRefundToOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        finalStatus: PayPalOrderStatus.REFUNDED,
        refundedAmountMinor: 2500n,
      }),
    );
    const audit = h.events.publish.mock.calls.find(
      (call: unknown[]) => call[0] === AuditEvents.LOG_EVENT,
    );
    expect(audit?.[1]).toMatchObject({ userId: 'system:paypal-webhook' });
  });

  it('reconcileRefund sin captura previa lanza 409 PAYMENT_INVALID_TRANSITION', async () => {
    const h = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'APPROVED' })),
    });

    const error = await errorOf(() =>
      h.service.reconcileRefund(
        {
          id: ORDER_ID,
          tenantId: TENANT_A,
          captureId: null,
          amountMinor: 2500n,
          capturedAmountMinor: null,
          refundedAmountMinor: null,
          currency: 'USD',
        },
        '',
        'REFUND-8',
        1000n,
      ),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(((error as ConflictException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INVALID_TRANSITION',
    );
  });
});

// ─── Superficie RPC y helpers compartidos ────────────────────────────────────

describe('Surface RPC de pagos (SF3-09)', () => {
  it('el patrón orders.capture entrega el dto mínimo y el contexto al servicio', async () => {
    const capture = vi.fn().mockResolvedValue({});
    const refund = vi.fn().mockResolvedValue({});
    const webhook = vi.fn().mockResolvedValue({});
    const createOrder = vi.fn();
    const controller = new PayPalOrdersController(
      { createOrder } as never,
      { capture, refund } as never,
      { handleWebhook: webhook } as never,
    );

    await controller.captureOrder({
      orderId: ORDER_ID,
      tenantId: TENANT_A,
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
      amountMinor: '1000',
    });

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
      ORDER_ID,
      { amountMinor: '1000' },
    );

    await controller.refundOrder({
      orderId: ORDER_ID,
      tenantId: TENANT_A,
      userId: 'user-1',
      role: UserRole.TENANT_ADMIN,
      reason: 'Servicio no prestado',
    });
    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.TENANT_ADMIN }),
      ORDER_ID,
      { reason: 'Servicio no prestado' },
    );

    await controller.handleWebhook({ payload: { id: 'WH-1' }, headers: {}, rawBody: '{}' });
    expect(webhook).toHaveBeenCalledWith({ id: 'WH-1' }, {}, '{}');
  });
});

describe('Helpers compartidos (paypal-support, SF3-09)', () => {
  it('la vista de reembolso expone motivo/actor/importe en minor', () => {
    const view = toPayPalRefundView({
      id: 'r-1',
      tenantId: TENANT_A,
      orderId: ORDER_ID,
      paypalRefundId: 'REFUND-1',
      captureId: 'CAPTURE-1',
      amountMinor: 1000n,
      currency: 'USD',
      reason: 'Servicio no prestado',
      requestedBy: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(view.amountMinor).toBe('1000');
    expect(view).toMatchObject({ reason: 'Servicio no prestado', requestedBy: 'user-1' });
  });

  it('mapPayPalErrorToHttpException conserva los códigos PAYMENT_* estables', () => {
    const logger = { warn: vi.fn(), error: vi.fn() } as never;
    const timeout = mapPayPalErrorToHttpException(
      new PayPalClientError('PAYPAL_TIMEOUT', 't'),
      logger,
      'x',
    );
    expect((timeout as HttpException).getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);

    const notConfigured = mapPayPalErrorToHttpException(
      new PayPalClientError('PAYPAL_NOT_CONFIGURED', 'c'),
      logger,
      'x',
    );
    expect((notConfigured as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);

    const unexpected = mapPayPalErrorToHttpException(new Error('boom'), logger, 'x');
    expect((unexpected as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(((unexpected as HttpException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INTERNAL_ERROR',
    );
  });

  it('paymentOrderNotFound responde 404 PAYMENT_ORDER_NOT_FOUND', () => {
    expect((paymentOrderNotFound() as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('los errores de transición expuestos son HTTP 409 con código tipado', async () => {
    const harness = paymentHarness({
      findOrderById: vi.fn().mockResolvedValue(orderRow({ status: 'FAILED' })),
    });

    const error = await errorOf(() => harness.service.capture(ctxA, ORDER_ID, {}));

    expect(error).toBeInstanceOf(ConflictException);
    expect(((error as ConflictException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_INVALID_TRANSITION',
    );
  });
});
