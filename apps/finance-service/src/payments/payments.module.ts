import { Module } from '@nestjs/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { PayPalOrdersController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PayPalClient } from './paypal-client';
import { PayPalOrderService } from './paypal-order.service';
import { PayPalPaymentService } from './paypal-payment.service';
import { PayPalWebhookService } from './paypal-webhook.service';

/**
 * Dominio de pagos (SF3-08/09): cliente PayPal + órdenes idempotentes +
 * capturas/reembolsos con máquina de estados + webhooks firmados con
 * deduplicación por `event_id`.
 */
@Module({
  imports: [FinanceDatabaseModule, EventsModule],
  controllers: [PayPalOrdersController],
  providers: [
    PayPalClient,
    PaymentsRepository,
    PayPalOrderService,
    PayPalPaymentService,
    PayPalWebhookService,
  ],
  exports: [PayPalOrderService, PayPalPaymentService],
})
export class PaymentsModule {}
