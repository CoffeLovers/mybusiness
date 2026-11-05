import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { PaymentsGatewayController } from './payments.controller';

/** BFF de pagos: reenvía la creación de órdenes a finance-service por Redis. */
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
  controllers: [PaymentsGatewayController],
})
export class PaymentsModule {}
