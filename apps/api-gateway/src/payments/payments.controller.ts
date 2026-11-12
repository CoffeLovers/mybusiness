import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import {
  CapturePayPalOrderDto,
  CreatePayPalOrderDto,
  PaymentsPatterns,
  PAYMENTS_WRITE_ROLES,
  RefundPayPalOrderDto,
  type PayPalOrderView,
  type PayPalRefundView,
  type PayPalWebhookResult,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Public, Roles, rpcSend } from '@mybusiness/common';

/** Límite de longitud de la clave de idempotencia (columna varchar(255)). */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Presupuesto de carga del webhook del proveedor (regla banking #47). */
const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * BFF de pagos (SF3-08/09): validación de entrada, RBAC de cobro y reenvío RPC
 * a finance-service. Los detalles del proveedor PayPal no deben cruzar la
 * capa; la respuesta pública de los endpoints es la vista de la orden/reembolso.
 * 400/401/404/409/502 provienen estructurados del microservicio.
 */
@ApiTags('Payments')
@SkipThrottle({ auth: true, heavy: true })
@Controller('payments')
export class PaymentsGatewayController {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  /**
   * Permiso de cobro (`payments:write`: accountant, tenant-admin y super-admin,
   * ver `PAYMENTS_WRITE_ROLES`). La clave de idempotencia viaja en el header
   * `Idempotency-Key`: repetir la petición con la misma clave devuelve la orden
   * original sin crear otra (ADR 003 §4).
   */
  @Roles(...PAYMENTS_WRITE_ROLES)
  @Post('paypal/orders')
  createPayPalOrder(
    @CurrentUser() user: UserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePayPalOrderDto,
  ): Observable<PayPalOrderView> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('El header Idempotency-Key es obligatorio.');
    }

    if (idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new BadRequestException(
        `El header Idempotency-Key no debe exceder ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres.`,
      );
    }

    return rpcSend(this.financeClient, PaymentsPatterns.PAYPAL_CREATE_ORDER, {
      ...dto,
      idempotencyKey: idempotencyKey.trim(),
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  /**
   * Captura (total o parcial) de una orden aprobada por el pagador (SF3-09).
   * Estado inicial del deep-linking: el pagador aprueba en PayPal y el backend
   * captura con el importe completo u parcial. Transiciones inválidas → 409
   * PAYMENT_INVALID_TRANSITION; fallos del proveedor → 502 estable.
   */
  @Roles(...PAYMENTS_WRITE_ROLES)
  @Post('paypal/orders/:orderId/captures')
  capturePayPalOrder(
    @CurrentUser() user: UserContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto?: CapturePayPalOrderDto,
  ): Observable<PayPalOrderView> {
    return this.rpcCapture(user, orderId, dto);
  }

  /** Reembolso total/parcial con motivo obligatorio y auditoría (SF3-09). */
  @Roles(...PAYMENTS_WRITE_ROLES)
  @Post('paypal/orders/:orderId/refunds')
  refundPayPalOrder(
    @CurrentUser() user: UserContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RefundPayPalOrderDto,
  ): Observable<PayPalRefundView> {
    return rpcSend(this.financeClient, PaymentsPatterns.PAYPAL_REFUND, {
      ...dto,
      orderId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  private rpcCapture(
    user: UserContext,
    orderId: string,
    dto?: CapturePayPalOrderDto,
  ): Observable<PayPalOrderView> {
    const command = this.sourceCapture(dto);

    return rpcSend(this.financeClient, PaymentsPatterns.PAYPAL_CAPTURE, {
      ...command,
      orderId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  private sourceCapture(dto?: CapturePayPalOrderDto): CapturePayPalOrderDto {
    if (dto && dto.amountMinor !== undefined) {
      return { amountMinor: dto.amountMinor };
    }
    return {};
  }
}

/**
 * Webhook del proveedor PayPal: público/firmado, sin autenticación de JWT.
 * El body crudo y las cabeceras PayPal viajan por RPC para que finance-service
 * verifique la firma contra la API de verificación del proveedor y deduplique
 * por `event_id` (regla igual al webhook de banking #47, fail-closed → 401).
 */
@ApiTags('Webhooks')
@Controller('payments/paypal')
export class PayPalWebhooksGatewayController {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  @Public()
  @Post('webhooks')
  handleWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ): Observable<PayPalWebhookResult> {
    this.assertPayloadSize(req);

    return rpcSend(this.financeClient, PaymentsPatterns.PAYPAL_HANDLE_WEBHOOK, {
      payload,
      headers,
      rawBody: req.rawBody?.toString('utf8'),
    });
  }

  private assertPayloadSize(req: RawBodyRequest<Request>): void {
    if ((req.rawBody?.byteLength ?? 0) > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException('El cuerpo del webhook excede 256 KB.');
    }
  }
}
