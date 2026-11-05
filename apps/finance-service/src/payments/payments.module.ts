import { Module } from '@nestjs/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { PayPalOrdersController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PayPalClient } from './paypal-client';
import { PayPalOrderService } from './paypal-order.service';

/**
 * Dominio de pagos (SF3-08): cliente PayPal + órdenes idempotentes. Los
 * estados posteriores a CREATED (llave apply/captura) llegan con SF3-09.
 */
@Module({
  imports: [FinanceDatabaseModule, EventsModule],
  controllers: [PayPalOrdersController],
  providers: [PayPalClient, PaymentsRepository, PayPalOrderService],
  exports: [PayPalOrderService],
})
export class PaymentsModule {}
