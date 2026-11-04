import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import {
  ListReconciliationReviewQuery,
  ManualReconciliationDto,
  ReconciliationMetricsQuery,
  ReconciliationPatterns,
  RunReconciliationDto,
  UpdateReconciliationSettingsDto,
  type ReconciliationMetricsResponse,
  type ReconciliationReviewItemResponse,
  type ReconciliationRunResponse,
  type ReconciliationSettingsResponse,
  type UserContext,
} from '@mybusiness/contracts';
import { rpcSend } from '@mybusiness/common';

@Injectable()
export class ReconciliationService {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  getSettings(user: UserContext): Observable<ReconciliationSettingsResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.GET_SETTINGS, {
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  updateSettings(
    user: UserContext,
    dto: UpdateReconciliationSettingsDto,
  ): Observable<ReconciliationSettingsResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.UPDATE_SETTINGS, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  run(user: UserContext, dto: RunReconciliationDto): Observable<ReconciliationRunResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.RUN, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  listReview(
    user: UserContext,
    query: ListReconciliationReviewQuery,
  ): Observable<{
    items: ReconciliationReviewItemResponse[];
    nextCursor: string | null;
    total: number;
  }> {
    return rpcSend(this.financeClient, ReconciliationPatterns.LIST_REVIEW, {
      ...query,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  confirmReview(user: UserContext, matchId: string): Observable<ReconciliationReviewItemResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.CONFIRM_REVIEW, {
      matchId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  rejectReview(user: UserContext, matchId: string): Observable<ReconciliationReviewItemResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.REJECT_REVIEW, {
      matchId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  manualMatch(
    user: UserContext,
    dto: ManualReconciliationDto,
  ): Observable<ReconciliationReviewItemResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.MANUAL_MATCH, {
      ...dto,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  getMetrics(
    user: UserContext,
    query: ReconciliationMetricsQuery,
  ): Observable<ReconciliationMetricsResponse> {
    return rpcSend(this.financeClient, ReconciliationPatterns.GET_METRICS, {
      ...query,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }
}
