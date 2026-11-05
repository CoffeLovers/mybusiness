import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PaymentsPatterns,
  type CreatePayPalOrderRpcPayload,
  type PayPalOrderView,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { PayPalOrderService } from './paypal-order.service';

/** Superficie RPC del dominio de pagos expuesta por finance-service. */
@Controller()
export class PayPalOrdersController {
  constructor(private readonly paypalOrderService: PayPalOrderService) {}

  @MessagePattern(PaymentsPatterns.PAYPAL_CREATE_ORDER)
  createOrder(@Payload() data: CreatePayPalOrderRpcPayload): Promise<PayPalOrderView> {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data);
    return this.paypalOrderService.createOrder(ctx, dto);
  }
}
