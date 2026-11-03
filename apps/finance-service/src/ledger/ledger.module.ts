import { Module } from '@nestjs/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [FinanceDatabaseModule, EventsModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
