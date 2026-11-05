import { HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { type PayPalOrderView, type PayPalRefundView } from '@mybusiness/contracts';
import { PayPalClientError } from './paypal-client';

/** Vista pública de una orden PayPal: nunca incluye la respuesta cruda (SF3-08/09). */
export function toPayPalOrderView(order: {
  id: string;
  tenantId: string;
  invoiceId: string;
  paypalOrderId: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  checkoutUrl: string;
  createdAt: Date;
  captureId?: string | null;
  capturedAmountMinor?: bigint | null;
  refundedAmountMinor?: bigint | null;
}): PayPalOrderView {
  return {
    id: order.id,
    tenantId: order.tenantId,
    invoiceRef: order.invoiceId,
    paypalOrderId: order.paypalOrderId,
    status: order.status as PayPalOrderView['status'],
    amountMinor: order.amountMinor.toString(),
    currency: order.currency,
    checkoutUrl: order.checkoutUrl,
    createdAt: order.createdAt.toISOString(),
    ...(order.captureId ? { captureId: order.captureId } : {}),
    ...(order.capturedAmountMinor != null
      ? { capturedAmountMinor: order.capturedAmountMinor.toString() }
      : {}),
    ...(order.refundedAmountMinor != null
      ? { refundedAmountMinor: order.refundedAmountMinor.toString() }
      : {}),
  };
}

/** Vista pública de un reembolso registrado (SF3-09). */
export function toPayPalRefundView(refund: {
  id: string;
  tenantId: string;
  orderId: string;
  paypalRefundId: string;
  captureId: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
  requestedBy: string;
  createdAt: Date;
}): PayPalRefundView {
  return {
    id: refund.id,
    tenantId: refund.tenantId,
    orderId: refund.orderId,
    paypalRefundId: refund.paypalRefundId,
    captureId: refund.captureId,
    amountMinor: refund.amountMinor.toString(),
    currency: refund.currency,
    reason: refund.reason,
    requestedBy: refund.requestedBy,
    createdAt: refund.createdAt.toISOString(),
  };
}

/** Status HTTP estructurado `PAYMENT_*`, estable y sin detalles del proveedor. */
export function paymentHttpException(
  statusCode: number,
  error: string,
  message: string,
): HttpException {
  return new HttpException({ statusCode, message, error }, statusCode);
}

/** 404 tipado: no existe la orden para el tenant (o es de otro tenant). */
export function paymentOrderNotFound(): HttpException {
  return paymentHttpException(
    HttpStatus.NOT_FOUND,
    'PAYMENT_ORDER_NOT_FOUND',
    'Orden de pago no encontrada para el tenant.',
  );
}

/**
 * Traduce los errores tipados del cliente a códigos HTTP estables (mismos
 * códigos que SF3-08). Los mensajes nunca revelan credenciales, tokens ni
 * cuerpos del proveedor.
 */
export function mapPayPalErrorToHttpException(
  error: unknown,
  logger: Logger,
  context: string,
  providerUnavailableCode = 'PAYMENT_PROVIDER_UNAVAILABLE',
): HttpException {
  if (error instanceof PayPalClientError) {
    logger.warn(`Error del proveedor de pagos en ${context} (código ${error.code})`);

    switch (error.code) {
      case 'PAYPAL_TIMEOUT':
        return paymentHttpException(
          HttpStatus.GATEWAY_TIMEOUT,
          'PAYMENT_PROVIDER_TIMEOUT',
          'El proveedor de pagos no respondió a tiempo',
        );
      case 'PAYPAL_RATE_LIMITED':
        return paymentHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          'PAYMENT_PROVIDER_RATE_LIMITED',
          'El proveedor de pagos alcanzó su límite de solicitudes',
        );
      case 'PAYPAL_NOT_CONFIGURED':
        logger.error('Credenciales de PayPal ausentes en la configuración del servicio');
        break;
      default:
        break;
    }

    return paymentHttpException(
      HttpStatus.BAD_GATEWAY,
      providerUnavailableCode,
      'El proveedor de pagos rechazó la operación',
    );
  }

  if (error instanceof NotFoundException) {
    return error;
  }

  logger.error(`Fallo inesperado en ${context}`, error instanceof Error ? error.stack : undefined);
  return paymentHttpException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'PAYMENT_INTERNAL_ERROR',
    'No se pudo completar la operación de pago',
  );
}
