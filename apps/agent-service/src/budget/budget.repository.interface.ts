import type { AgentUsageSummary } from '@mybusiness/contracts';
import type {
  AgentTokenBudget,
  AgentTokenReservation,
  AgentTokenUsage,
  NewAgentTokenUsage,
} from '../database/schema';

export const BUDGET_REPOSITORY = Symbol('BUDGET_REPOSITORY');

export interface ReserveAtomicParams {
  tenantId: string;
  periodKey: string;
  correlationId: string;
  estimatedCostMicroUsd: number;
  defaultLimitMicroUsd: number;
  defaultWarnRatio: number;
  defaultHardLimit: boolean;
}

export interface ReserveAtomicResult {
  granted: boolean;
  budget: AgentTokenBudget;
  reservation?: AgentTokenReservation;
  reason?: string;
}

export interface SettleReservationParams {
  tenantId: string;
  periodKey: string;
  correlationId: string;
  actualCostMicroUsd: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
  conversationId?: string;
  cacheHit?: boolean;
  degraded?: boolean;
}

export interface SettleReservationResult {
  budget: AgentTokenBudget;
  reservation: AgentTokenReservation;
  usage: AgentTokenUsage;
}

export interface ReleaseReservationParams {
  tenantId: string;
  periodKey: string;
  correlationId: string;
}

export interface ReleaseReservationResult {
  budget?: AgentTokenBudget;
  releasedMicroUsd: number;
}

export interface IBudgetRepository {
  getOrCreateBudget(
    tenantId: string,
    periodKey: string,
    defaultLimitMicroUsd: number,
    defaultWarnRatio: number,
    defaultHardLimit: boolean,
  ): Promise<AgentTokenBudget>;

  findBudget(tenantId: string, periodKey: string): Promise<AgentTokenBudget | null>;

  reserveAtomic(params: ReserveAtomicParams): Promise<ReserveAtomicResult>;

  settleReservation(params: SettleReservationParams): Promise<SettleReservationResult>;

  releaseReservation(params: ReleaseReservationParams): Promise<ReleaseReservationResult>;

  findReservation(tenantId: string, correlationId: string): Promise<AgentTokenReservation | null>;

  recordUsage(params: NewAgentTokenUsage): Promise<AgentTokenUsage>;

  getUsageSummary(tenantId: string, periodKey: string): Promise<AgentUsageSummary>;

  recordBudgetExhaustedEvent(tenantId: string, periodKey: string): Promise<boolean>;
}
