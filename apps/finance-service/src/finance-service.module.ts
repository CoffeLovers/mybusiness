import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  RpcTenantContextInterceptor,
  RpcTenantGuard,
  getRootEnvFilePaths,
} from '@mybusiness/common';
import { FinanceDatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { BankingModule } from './banking/banking.module';
import { CashflowModule } from './cashflow/cashflow.module';
import { DocumentsModule } from './documents/documents.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    FinanceDatabaseModule,
    EventsModule,
    BankingModule,
    CashflowModule,
    DocumentsModule,
    ReconciliationModule,
  ],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FinanceRepository,
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
