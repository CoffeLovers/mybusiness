import { Module } from '@nestjs/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { CashflowController } from './cashflow.controller';
import { CashflowService } from './cashflow.service';

@Module({
  imports: [FinanceDatabaseModule],
  controllers: [CashflowController],
  providers: [CashflowService],
  exports: [CashflowService],
})
export class CashflowModule {}
