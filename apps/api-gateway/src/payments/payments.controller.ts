import { BadRequestException, Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import {
  CreatePayPalOrderDto,
  PaymentsPatterns,
  PAYMENTS_WRITE_ROLES,
  type PayPalOrderView,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser, Roles, rpcSend } from '@mybusiness/common';

/** Límite de longitud de la clave de idempotencia (columna varchar(255)). */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/**
 * BFF de pagos (SF3-08): validación de entrada, RBAC de cobro y reenvío RPC a
 * finance-service. Los detalles del proveedor PayPal no deben cruzar la capa;
 * la respuesta pública del endpoint es la vista de la orden.
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
}
