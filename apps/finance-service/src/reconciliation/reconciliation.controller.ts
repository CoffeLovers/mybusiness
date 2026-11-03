import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ReconciliationPatterns,
  type ConfirmReconciliationReviewPayload,
  type GetReconciliationMetricsPayload,
  type GetReconciliationSettingsPayload,
  type ListReconciliationReviewPayload,
  type ManualReconciliationDto,
  type ManualReconciliationPayload,
  type RejectReconciliationReviewPayload,
  type RunReconciliationPayload,
  type UpdateReconciliationSettingsDto,
  type UpdateReconciliationSettingsPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { ReconciliationService } from './reconciliation.service';

@Controller()
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @MessagePattern(ReconciliationPatterns.GET_SETTINGS)
  getSettings(@Payload() data: GetReconciliationSettingsPayload) {
    const ctx = extractRpcContext(data);
    return this.reconciliationService.getSettings(ctx);
  }

  @MessagePattern(ReconciliationPatterns.UPDATE_SETTINGS)
  updateSettings(@Payload() data: UpdateReconciliationSettingsPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as UpdateReconciliationSettingsDto;
    return this.reconciliationService.updateSettings(ctx, dto);
  }

  @MessagePattern(ReconciliationPatterns.RUN)
  run(@Payload() data: RunReconciliationPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as { trigger?: any; from?: string; to?: string };
    return this.reconciliationService.runForTenant(ctx.tenantId, dto.trigger, dto.from, dto.to);
  }

  @MessagePattern(ReconciliationPatterns.LIST_REVIEW)
  listReview(@Payload() data: ListReconciliationReviewPayload) {
    const ctx = extractRpcContext(data);
    const { cursor, limit } = stripRpcContext(data) as { cursor?: string; limit?: number };
    return this.reconciliationService.listReview(ctx, cursor, limit);
  }

  @MessagePattern(ReconciliationPatterns.CONFIRM_REVIEW)
  confirmReview(@Payload() data: ConfirmReconciliationReviewPayload) {
    const ctx = extractRpcContext(data);
    const { matchId } = stripRpcContext(data) as { matchId: string };
    return this.reconciliationService.confirmReview(ctx, matchId);
  }

  @MessagePattern(ReconciliationPatterns.REJECT_REVIEW)
  rejectReview(@Payload() data: RejectReconciliationReviewPayload) {
    const ctx = extractRpcContext(data);
    const { matchId } = stripRpcContext(data) as { matchId: string };
    return this.reconciliationService.rejectReview(ctx, matchId);
  }

  @MessagePattern(ReconciliationPatterns.MANUAL_MATCH)
  manualMatch(@Payload() data: ManualReconciliationPayload) {
    const ctx = extractRpcContext(data);
    const dto = stripRpcContext(data) as ManualReconciliationDto;
    return this.reconciliationService.manualMatch(ctx, dto);
  }

  @MessagePattern(ReconciliationPatterns.GET_METRICS)
  getMetrics(@Payload() data: GetReconciliationMetricsPayload) {
    const ctx = extractRpcContext(data);
    const { from, to } = stripRpcContext(data) as { from?: string; to?: string };
    return this.reconciliationService.getMetrics(ctx, from, to);
  }
}
