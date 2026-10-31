import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import {
  RpcTenantContextInterceptor,
  RpcTenantGuard,
  getMicroserviceRedisOptions,
  getRootEnvFilePaths,
} from '@mybusiness/common';
import { FinanceDatabaseModule } from './database/database.module';
import { FINANCE_EVENT_BUS, DomainEventPublisher } from './events/domain-event.publisher';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { BankingModule } from './banking/banking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    FinanceDatabaseModule,
    BankingModule,
  ],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FinanceRepository,
    DomainEventPublisher,
    {
      provide: FINANCE_EVENT_BUS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
    },
    {
      provide: APP_GUARD,
      useClass: RpcTenantGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RpcTenantContextInterceptor,
    },
  ],
})
export class FinanceServiceModule {}
