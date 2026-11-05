import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  AuditEvents,
  PayPalOrderStatus,
  PaymentsPatterns,
  UserRole,
  type CreatePayPalOrderDto,
  type RequestContext,
} from '@mybusiness/contracts';
import { PayPalOrderService } from '../src/payments/paypal-order.service';
import { PayPalClient, PayPalClientError } from '../src/payments/paypal-client';
import { PayPalOrdersController } from '../src/payments/payments.controller';
import type { PaymentsRepository } from '../src/payments/payments.repository';
import type { DomainEventPublisher } from '../src/events/domain-event.publisher';
import type { PayPalOrder } from '../src/database/schema';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';

const ctxA: RequestContext = {
  tenantId: TENANT_A,
  userId: 'user-1',
  role: UserRole.ACCOUNTANT,
};

function orderRow(overrides: Partial<PayPalOrder> = {}): PayPalOrder {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantId: TENANT_A,
    invoiceId: INVOICE_ID,
    status: 'CREATED',
    amountMinor: 250000n,
    currency: 'COP',
    paypalOrderId: 'PAYPAL-123',
    idempotencyKey: 'idem-1',
    checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123',
    providerResponse: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function validDto(overrides: Partial<CreatePayPalOrderDto> = {}): CreatePayPalOrderDto {
  return {
    amountMinor: '250000',
    currency: 'COP',
    description: 'Factura INV-001',
    invoiceRef: INVOICE_ID,
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

interface Harness {
  service: PayPalOrderService;
  repository: {
    findInvoiceById: ReturnType<typeof vi.fn>;
    findOrderByIdempotencyKey: ReturnType<typeof vi.fn>;
    createOrderIdempotent: ReturnType<typeof vi.fn>;
  };
  client: { createOrder: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const repository = {
    findInvoiceById: vi.fn().mockResolvedValue({ currency: 'COP' }),
    findOrderByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createOrderIdempotent: vi.fn().mockResolvedValue({ order: orderRow(), created: true }),
  };
  const client = {
    createOrder: vi.fn().mockResolvedValue({
      id: 'PAYPAL-123',
      status: 'CREATED',
      links: [
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-123' },
      ],
      raw: { id: 'PAYPAL-123', status: 'CREATED' },
    }),
  };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };

  const service = new PayPalOrderService(
    repository as unknown as PaymentsRepository,
    client as unknown as PayPalClient,
    events as unknown as DomainEventPublisher,
  );

  return { service, repository, client, events };
}

describe('PayPalOrderService (SF3-08)', () => {
  it('crea la orden, la persiste con estado CREATED y audita factura/importe/actor', async () => {
    const harness = createHarness();

    const view = await harness.service.createOrder(ctxA, validDto());

    expect(harness.client.createOrder).toHaveBeenCalledTimes(1);
    expect(harness.repository.createOrderIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        invoiceId: INVOICE_ID,
        amountMinor: 250000n,
        idempotencyKey: 'idem-1',
      }),
    );
    expect(view).toEqual(
      expect.objectContaining({
        status: PayPalOrderStatus.CREATED,
        checkoutUrl: expect.stringContaining('checkoutnow'),
        amountMinor: '250000',
      }),
    );
    expect(harness.events.publish).toHaveBeenCalledTimes(1);
    const [pattern, event] = harness.events.publish.mock.calls[0];
    expect(pattern).toBe(AuditEvents.LOG_EVENT);
    expect(event).toMatchObject({
      action: 'payments.paypal.order.created',
      tenantId: TENANT_A,
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
      newValues: expect.objectContaining({ invoiceId: INVOICE_ID, amountMinor: '250000' }),
    });
  });

  it('repetir la misma clave de idempotencia devuelve la orden original sin llamar a PayPal', async () => {
    const harness = createHarness();
    harness.repository.findOrderByIdempotencyKey.mockResolvedValueOnce(orderRow());

    const view = await harness.service.createOrder(ctxA, validDto());

    expect(harness.client.createOrder).not.toHaveBeenCalled();
    expect(harness.repository.createOrderIdempotent).not.toHaveBeenCalled();
    expect(harness.events.publish).not.toHaveBeenCalled();
    expect(view.paypalOrderId).toBe('PAYPAL-123');
  });

  it.each(['0', '-1', '12.5', '1e3', 'abc', ''])(
    'rechaza importes no enteros positivos (%s) antes de salir del proceso',
    async (amountMinor) => {
      const harness = createHarness();

      await expect(
        harness.service.createOrder(ctxA, validDto({ amountMinor })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(harness.client.createOrder).not.toHaveBeenCalled();
      expect(harness.repository.createOrderIdempotent).not.toHaveBeenCalled();
    },
  );

  it('rechaza la moneda que no coincide con la de la factura', async () => {
    const harness = createHarness();
    harness.repository.findInvoiceById.mockResolvedValueOnce({ currency: 'COP' });

    await expect(
      harness.service.createOrder(ctxA, validDto({ currency: 'USD' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.client.createOrder).not.toHaveBeenCalled();
  });

  it('factura de otro tenant no es visible: 404 estable y sin orden', async () => {
    const harness = createHarness();
    harness.repository.findInvoiceById.mockImplementation(async (tenantId: string) =>
      tenantId === TENANT_A ? { currency: 'COP' } : null,
    );

    await expect(
      harness.service.createOrder({ ...ctxA, tenantId: TENANT_B }, validDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.client.createOrder).not.toHaveBeenCalled();
    expect(harness.repository.createOrderIdempotent).not.toHaveBeenCalled();
  });

  it('un error del proveedor produce un código HTTP estable sin filtrar credenciales', async () => {
    const harness = createHarness();
    harness.client.createOrder.mockRejectedValueOnce(
      new PayPalClientError('PAYPAL_AUTH', 'El proveedor de pagos rechazó la autenticación', 401),
    );

    const error = await harness.service.createOrder(ctxA, validDto()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = (error as HttpException).getResponse() as Record<string, unknown>;
    expect(body.error).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(harness.repository.createOrderIdempotent).not.toHaveBeenCalled();
    expect(harness.events.publish).not.toHaveBeenCalled();
  });

  it('la ausencia de enlace approve no persiste ni audita', async () => {
    const harness = createHarness();
    harness.client.createOrder.mockResolvedValueOnce({
      id: 'P2',
      status: 'CREATED',
      links: [],
      raw: {},
    });

    await expect(harness.service.createOrder(ctxA, validDto())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(harness.repository.createOrderIdempotent).not.toHaveBeenCalled();
    expect(harness.events.publish).not.toHaveBeenCalled();
  });
});

describe('PayPalOrdersController (superficie RPC con contexto del sobre)', () => {
  it('extrae el contexto multi-tenant del payload y respeta el patrón del contrato', async () => {
    const harness = createHarness();
    const controller = new PayPalOrdersController(harness.service);
    const spy = vi.spyOn(harness.service, 'createOrder');

    await controller.createOrder({
      ...validDto(),
      tenantId: TENANT_A,
      userId: 'user-1',
      role: UserRole.ACCOUNTANT,
    });

    expect(spy).toHaveBeenCalledWith(ctxA, validDto());
    expect(PaymentsPatterns.PAYPAL_CREATE_ORDER).toBe('payments.paypal.orders.create');
  });
});
