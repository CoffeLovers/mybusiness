import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES, createQueue, queueToken } from '@mybusiness/common';
import { BankingModule } from '../banking/banking.module';
import { FinanceDatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationWorker } from './reconciliation.worker';

@Module({
  imports: [ConfigModule, FinanceDatabaseModule, EventsModule, BankingModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    ReconciliationScheduler,
    ReconciliationWorker,
    {
      provide: queueToken(QUEUE_NAMES.RECONCILIATION),
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createQueue(QUEUE_NAMES.RECONCILIATION, config),
    },
  ],
  exports: [ReconciliationService, ReconciliationScheduler],
})
export class ReconciliationModule {}
