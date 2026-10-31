import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FinanceDatabaseService } from '../database/database.service';
import { PlaidAdapter } from './adapters/plaid.adapter';
import { BelvoAdapter } from './adapters/belvo.adapter';
import { BankingAggregatorService } from './banking-aggregator.service';
import { BankingEncryptionService } from './banking-encryption.service';
import { BankingSyncService } from './banking-sync.service';
import { BankingWebhookService } from './banking-webhook.service';
import { BankingService } from './banking.service';
import { BankingController } from './banking.controller';

@Module({
  imports: [ConfigModule],
  controllers: [BankingController],
  providers: [
    FinanceDatabaseService,
    PlaidAdapter,
    BelvoAdapter,
    BankingAggregatorService,
    BankingEncryptionService,
    BankingSyncService,
    BankingWebhookService,
    BankingService,
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
