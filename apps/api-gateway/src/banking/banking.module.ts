import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { BankingController, BankingWebhooksController } from './banking.controller';
import { BankingService } from './banking.service';

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
  controllers: [BankingController, BankingWebhooksController],
  providers: [BankingService],
  exports: [BankingService],
})
export class BankingModule {}
