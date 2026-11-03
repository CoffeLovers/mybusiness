import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES, createQueue, queueToken } from '@mybusiness/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { PlaidAdapter } from './adapters/plaid.adapter';
import { BelvoAdapter } from './adapters/belvo.adapter';
import { BankingAggregatorService } from './banking-aggregator.service';
import { BankingEncryptionService } from './banking-encryption.service';
import { BankingSyncService } from './banking-sync.service';
import { BankingWebhookProcessor } from './banking-webhook.processor';
import { BankingWebhookService } from './banking-webhook.service';
import { BankingWebhookWorker } from './banking-webhook.worker';
import { BankingService } from './banking.service';
import { BankingController } from './banking.controller';

@Module({
  imports: [ConfigModule, FinanceDatabaseModule, EventsModule],
  controllers: [BankingController],
  providers: [
    PlaidAdapter,
    BelvoAdapter,
    BankingAggregatorService,
    BankingEncryptionService,
    BankingSyncService,
    BankingWebhookProcessor,
    BankingWebhookService,
    BankingWebhookWorker,
    BankingService,
    {
      provide: queueToken(QUEUE_NAMES.BANKING_SYNC),
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createQueue(QUEUE_NAMES.BANKING_SYNC, config),
    },
  ],
  exports: [
    BankingService,
    BankingAggregatorService,
    BankingEncryptionService,
    BankingSyncService,
    BankingWebhookService,
    PlaidAdapter,
    BelvoAdapter,
  ],
})
export class BankingModule {}
