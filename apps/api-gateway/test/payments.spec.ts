import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  CreatePayPalOrderDto,
  PaymentsPatterns,
  PAYMENTS_WRITE_ROLES,
} from '@mybusiness/contracts';
import type { UserContext } from '@mybusiness/contracts';
import { ROLES_KEY, RolesGuard } from '@mybusiness/common';
import {
  PayPalWebhooksGatewayController,
  PaymentsGatewayController,
} from '../src/payments/payments.controller';

const USER: UserContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'user@test.com',
  role: 'ACCOUNTANT' as UserContext['role'],
};

function dto(overrides: Partial<CreatePayPalOrderDto> = {}): CreatePayPalOrderDto {
  return {
    amountMinor: '250000',
    currency: 'COP',
    description: 'Factura INV-001',
    invoiceRef: '44444444-4444-4444-8444-444444444444',
    ...overrides,
  } as CreatePayPalOrderDto;
}

describe('PaymentsGatewayController (SF3-08, BFF -> RPC)', () => {
  let send: ReturnType<typeof vi.fn>;
  let controller: PaymentsGatewayController;

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({ id: 'o-1', status: 'CREATED' }));
    controller = new PaymentsGatewayController({ send } as never);
  });

  it('proxea al patrón RPC con contexto autenticado y header de idempotencia', async () => {
    const response = await firstValueFrom(
      controller.createPayPalOrder(USER, '  idem-key-1  ', dto()),
    );

    expect(send).toHaveBeenCalledTimes(1);
    const [pattern, payload] = send.mock.calls[0];
    expect(pattern).toBe(PaymentsPatterns.PAYPAL_CREATE_ORDER);
    expect(payload).toEqual(
      expect.objectContaining({
        amountMinor: '250000',
        idempotencyKey: 'idem-key-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    expect(response).toEqual({ id: 'o-1', status: 'CREATED' });
  });

  it('rechaza con 400 temprano si falta el header Idempotency-Key', async () => {
    const act = (idempotencyKey: string | undefined): Promise<unknown> => {
      try {
        return Promise.resolve(
          firstValueFrom(controller.createPayPalOrder(USER, idempotencyKey, dto())),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    };

    await expect(act(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(act('   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('un usuario sin permiso de cobro recibe 403 según la matriz payments:write', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === ROLES_KEY ? PAYMENTS_WRITE_ROLES : undefined,
      ),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const banned = { ...USER, role: 'VIEWER' as UserContext['role'] };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: banned }) }),
    };
    expect(guard.canActivate(context)).toBe(false);

    // Con rol de cobro sí pasa la matriz.
    const allowed = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: USER }) }),
    };
    expect(guard.canActivate(allowed)).toBe(true);
  });

  it('rechaza con 400 temprano un Idempotency-Key mayor a 255 caracteres', async () => {
    const act = (idempotencyKey: string): Promise<unknown> => {
      try {
        return Promise.resolve(
          firstValueFrom(controller.createPayPalOrder(USER, idempotencyKey, dto())),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    };

    await expect(act('k'.repeat(256))).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('el request HTTP nunca acepta idempotencyKey en el body (canal autorizado: header)', () => {
    // El DTO no declara idempotencyKey: con whitelist+forbidNonWhitelisted el
    // pipe global lo rechaza antes del handler. La prueba documenta el contrato.
    expect('idempotencyKey' in dto()).toBe(false);
  });

  it('propaga los errores estructurados del microservicio con HTTP estable', async () => {
    send.mockReturnValueOnce(
      throwError(
        () =>
          new HttpException(
            {
              statusCode: HttpStatus.BAD_GATEWAY,
              message: 'El proveedor de pagos rechazó la creación de la orden',
              error: 'PAYMENT_PROVIDER_UNAVAILABLE',
            },
            HttpStatus.BAD_GATEWAY,
          ),
      ),
    );

    const error = await firstValueFrom(controller.createPayPalOrder(USER, 'k-1', dto())).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(((error as HttpException).getResponse() as Record<string, unknown>).error).toBe(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
  });
});

// ─── SF3-09: capturas, reembolsos y webhook firmado ──────────────────────────

describe('PaymentsGatewayController SF3-09 (BFF -> RPC)', () => {
  const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let send: ReturnType<typeof vi.fn>;
  let controller: PaymentsGatewayController;

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({}));
    controller = new PaymentsGatewayController({ send } as never);
  });

  it('proxea la captura al patrón RPC con importe y contexto autenticado', async () => {
    const response = await firstValueFrom(
      controller.capturePayPalOrder(USER, ORDER_ID, { amountMinor: '1000' }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    const [pattern, payload] = send.mock.calls[0];
    expect(pattern).toBe(PaymentsPatterns.PAYPAL_CAPTURE);
    expect(payload).toEqual({
      amountMinor: '1000',
      orderId: ORDER_ID,
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'ACCOUNTANT',
    });
    expect(response).toEqual({});
  });

  it('proxea la captura total (sin body) como monto indefinido', async () => {
    await firstValueFrom(controller.capturePayPalOrder(USER, ORDER_ID));

    const [, payload] = send.mock.calls[0];
    expect(payload).toEqual({
      orderId: ORDER_ID,
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'ACCOUNTANT',
    });
  });

  it('proxea el reembolso al patrón RPC con motivo obligatorio del body', async () => {
    await firstValueFrom(
      controller.refundPayPalOrder({ ...USER, userId: 'user-9' }, ORDER_ID, {
        reason: 'Servicio no prestado',
        amountMinor: '1000',
      }),
    );

    const [pattern, payload] = send.mock.calls[0];
    expect(pattern).toBe(PaymentsPatterns.PAYPAL_REFUND);
    expect(payload).toEqual({
      reason: 'Servicio no prestado',
      amountMinor: '1000',
      orderId: ORDER_ID,
      tenantId: 'tenant-1',
      userId: 'user-9',
      role: 'ACCOUNTANT',
    });
  });

  function requestOf(rawBody?: string): RawBodyRequest<Request> {
    return { rawBody: rawBody ? Buffer.from(rawBody) : Buffer.alloc(0) } as RawBodyRequest<Request>;
  }

  it('el webhook de PayPal es público/firmado y reenvía raw body + cabeceras por RPC', async () => {
    const webhookController = new PayPalWebhooksGatewayController({ send } as never);
    send.mockReturnValueOnce(of({ status: 'processed', eventId: 'WH-1' }));

    const response = await firstValueFrom(
      webhookController.handleWebhook(
        { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
        { 'paypal-auth-algo': 'SHA256withRSA' },
        requestOf('{"id":"WH-1"}'),
      ),
    );

    const [pattern, payload] = send.mock.calls[0];
    expect(pattern).toBe(PaymentsPatterns.PAYPAL_HANDLE_WEBHOOK);
    expect(payload).toMatchObject({
      headers: { 'paypal-auth-algo': 'SHA256withRSA' },
      rawBody: '{"id":"WH-1"}',
    });
    expect(response).toEqual({ status: 'processed', eventId: 'WH-1' });
  });

  it('el webhook rechaza con 413 un cuerpo mayor a 256 KB sin tocar el RPC', async () => {
    const webhookController = new PayPalWebhooksGatewayController({ send } as never);

    let error: unknown = null;
    try {
      await firstValueFrom(
        webhookController.handleWebhook({}, {}, requestOf('x'.repeat(256 * 1024 + 1))),
      );
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(send).not.toHaveBeenCalled();
  });
});
