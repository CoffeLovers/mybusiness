import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PaymentsPatterns,
  type CapturePayPalOrderDto,
  type CapturePayPalOrderRpcPayload,
  type CreatePayPalOrderDto,
  type CreatePayPalOrderRpcPayload,
  type PayPalOrderView,
  type PayPalRefundView,
  type PayPalWebhookResult,
  type PayPalWebhookRpcPayload,
  type RefundPayPalOrderDto,
  type RefundPayPalOrderRpcPayload,
  type RequestContext,
} from '@mybusiness/contracts';
import { extractRpcContext } from '@mybusiness/common';
import { PayPalPaymentService } from './paypal-payment.service';
import { PayPalWebhookService } from './paypal-webhook.service';
import { PayPalOrderService } from './paypal-order.service';

/** Superficie RPC del dominio de pagos expuesta por finance-service (SF3-08/09). */
@Controller()
export class PayPalOrdersController {
  constructor(
    private readonly paypalOrderService: PayPalOrderService,
    private readonly paypalPaymentService: PayPalPaymentService,
    private readonly paypalWebhookService: PayPalWebhookService,
  ) {}

  @MessagePattern(PaymentsPatterns.PAYPAL_CREATE_ORDER)
  createOrder(@Payload() data: CreatePayPalOrderRpcPayload): Promise<PayPalOrderView> {
    const ctx = extractRpcContext(data);
    const dto: CreatePayPalOrderDto = {
      amountMinor: data.amountMinor,
      currency: data.currency,
      description: data.description,
      invoiceRef: data.invoiceRef,
      idempotencyKey: data.idempotencyKey,
    };
    return this.paypalOrderService.createOrder(ctx, dto);
  }

  /** Captura total/parcial de una orden aprobada (SF3-09). */
  @MessagePattern(PaymentsPatterns.PAYPAL_CAPTURE)
  captureOrder(@Payload() data: CapturePayPalOrderRpcPayload): Promise<PayPalOrderView> {
    const ctx: RequestContext = extractRpcContext(data);
    const dto: CapturePayPalOrderDto = data.amountMinor ? { amountMinor: data.amountMinor } : {};
    return this.paypalPaymentService.capture(ctx, data.orderId, dto);
  }

  /** Reembolso total/parcial con motivo y actor (SF3-09). */
  @MessagePattern(PaymentsPatterns.PAYPAL_REFUND)
  refundOrder(@Payload() data: RefundPayPalOrderRpcPayload): Promise<PayPalRefundView> {
    const ctx: RequestContext = extractRpcContext(data);
    const dto: RefundPayPalOrderDto = {
      reason: data.reason,
      ...(data.amountMinor ? { amountMinor: data.amountMinor } : {}),
    };
    return this.paypalPaymentService.refund(ctx, data.orderId, dto);
  }

  /**
   * Webhook firmado del proveedor. No lleva contexto de tenant; la
   * verificación de firma y la deduplicación ocurren en finance-service.
   */
  @MessagePattern(PaymentsPatterns.PAYPAL_HANDLE_WEBHOOK)
  handleWebhook(@Payload() data: PayPalWebhookRpcPayload): Promise<PayPalWebhookResult> {
    return this.paypalWebhookService.handleWebhook(data.payload, data.headers, data.rawBody);
  }
}
