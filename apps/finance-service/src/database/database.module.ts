import { Module } from '@nestjs/common';
import { FinanceDatabaseService } from './database.service';

@Module({
  providers: [FinanceDatabaseService],
  exports: [FinanceDatabaseService],
})
export class FinanceDatabaseModule {}
