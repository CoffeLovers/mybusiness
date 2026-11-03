import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AgentPatterns,
  type GetAgentBudgetRpcPayload,
  type GetAgentUsageRpcPayload,
  type ReleaseTokenBudgetRpcPayload,
  type ReserveTokenBudgetRpcPayload,
  type SettleTokenBudgetRpcPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { BudgetService } from './budget.service';

@Controller()
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @MessagePattern(AgentPatterns.GET_BUDGET)
  getBudget(@Payload() data: GetAgentBudgetRpcPayload) {
    const ctx = extractRpcContext(data);
    const payload = stripRpcContext(data);
    return this.budgetService.getBudget(ctx.tenantId, payload.periodKey);
  }

  @MessagePattern(AgentPatterns.GET_USAGE)
  getUsage(@Payload() data: GetAgentUsageRpcPayload) {
    const ctx = extractRpcContext(data);
    const payload = stripRpcContext(data);
    return this.budgetService.getUsage(ctx.tenantId, payload.periodKey);
  }

  @MessagePattern(AgentPatterns.RESERVE_BUDGET)
  reserveBudget(@Payload() data: ReserveTokenBudgetRpcPayload) {
    const ctx = extractRpcContext(data);
    const payload = stripRpcContext(data);
    return this.budgetService.reserve({
      tenantId: ctx.tenantId,
      correlationId: payload.correlationId,
      estimatedCostMicroUsd: payload.estimatedCostMicroUsd,
    });
  }

  @MessagePattern(AgentPatterns.SETTLE_BUDGET)
  settleBudget(@Payload() data: SettleTokenBudgetRpcPayload) {
    const ctx = extractRpcContext(data);
    const payload = stripRpcContext(data);
    return this.budgetService.settle({
      tenantId: ctx.tenantId,
      correlationId: payload.correlationId,
      actualCostMicroUsd: payload.actualCostMicroUsd,
      promptTokens: payload.promptTokens,
      completionTokens: payload.completionTokens,
      model: payload.model,
      conversationId: payload.conversationId,
      cacheHit: payload.cacheHit,
      degraded: payload.degraded,
    });
  }

  @MessagePattern(AgentPatterns.RELEASE_BUDGET)
  releaseBudget(@Payload() data: ReleaseTokenBudgetRpcPayload) {
    const ctx = extractRpcContext(data);
    const payload = stripRpcContext(data);
    return this.budgetService.release({
      tenantId: ctx.tenantId,
      correlationId: payload.correlationId,
    });
  }
}
