import { Module } from '@nestjs/common';
import { AgentDatabaseService } from '../database/database.service';
import { SemanticCacheModule } from '../cache/cache.module';
import { BudgetController } from './budget.controller';
import { BudgetRepository } from './budget.repository';
import { BUDGET_REPOSITORY } from './budget.repository.interface';
import { BudgetService } from './budget.service';

@Module({
  imports: [SemanticCacheModule],
  controllers: [BudgetController],
  providers: [
    AgentDatabaseService,
    {
      provide: BUDGET_REPOSITORY,
      useClass: BudgetRepository,
    },
    BudgetRepository,
    BudgetService,
  ],
  exports: [BudgetService, BUDGET_REPOSITORY, SemanticCacheModule],
})
export class BudgetModule {}
