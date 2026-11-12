import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { PayPalWebhooksGatewayController, PaymentsGatewayController } from './payments.controller';

/** BFF de pagos: órdenes/capturas/reembolsos y webhooks PayPal via Redis RPC. */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'FINANCE_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
    ]),
  ],
  controllers: [PaymentsGatewayController, PayPalWebhooksGatewayController],
})
export class PaymentsModule {}
