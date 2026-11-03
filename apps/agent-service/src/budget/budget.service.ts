import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentDegradationReason,
  type AgentBudgetSnapshot,
  type AgentChatConsumption,
  type AgentDegradedResponse,
  type AgentUsageSummary,
  type ReleaseTokenBudgetResult,
  type ReserveTokenBudgetResult,
  type SettleTokenBudgetResult,
} from '@mybusiness/contracts';
import {
  BUDGET_CONSTANTS,
  calculateTokenCostMicroUsd,
  getUtcPeriodKey,
  parseConfigNumber,
  usdToMicroUsd,
} from './budget.constants';
import { BUDGET_REPOSITORY, type IBudgetRepository } from './budget.repository.interface';

export interface ReserveParams {
  tenantId: string;
  correlationId: string;
  estimatedCostMicroUsd: number;
  periodKey?: string;
}

export interface SettleParams {
  tenantId: string;
  correlationId: string;
  actualCostMicroUsd: number;
  promptTokens: number;
  completionTokens: number;
  model?: string;
  conversationId?: string;
  cacheHit?: boolean;
  degraded?: boolean;
  periodKey?: string;
}

export interface ReleaseParams {
  tenantId: string;
  correlationId: string;
  periodKey?: string;
}

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);
  private readonly monthlyBudgetMicroUsd: number;
  private readonly warnRatio: number;
  private readonly hardLimit = true;
  private readonly inputCostMicroUsdPer1k: number;
  private readonly outputCostMicroUsdPer1k: number;
  private readonly degradedModeEnabled: boolean;

  constructor(
    @Inject(BUDGET_REPOSITORY)
    private readonly budgetRepository: IBudgetRepository,
    private readonly config: ConfigService,
  ) {
    const monthlyBudgetUsd = parseConfigNumber(
      this.config.get<unknown>('AGENT_TOKEN_BUDGET_USD_MONTHLY'),
      BUDGET_CONSTANTS.DEFAULT_BUDGET_USD_MONTHLY,
      0.01,
      1_000_000,
      'AGENT_TOKEN_BUDGET_USD_MONTHLY',
    );
    this.monthlyBudgetMicroUsd = usdToMicroUsd(monthlyBudgetUsd);

    this.warnRatio = parseConfigNumber(
      this.config.get<unknown>('AGENT_BUDGET_WARN_RATIO'),
      BUDGET_CONSTANTS.DEFAULT_WARN_RATIO,
      0.01,
      1,
      'AGENT_BUDGET_WARN_RATIO',
    );

    const inputCostUsd = parseConfigNumber(
      this.config.get<unknown>('AGENT_MODEL_INPUT_COST_PER_1K_USD'),
      BUDGET_CONSTANTS.DEFAULT_INPUT_COST_PER_1K_USD,
      0,
      1000,
      'AGENT_MODEL_INPUT_COST_PER_1K_USD',
    );
    this.inputCostMicroUsdPer1k = usdToMicroUsd(inputCostUsd);

    const outputCostUsd = parseConfigNumber(
      this.config.get<unknown>('AGENT_MODEL_OUTPUT_COST_PER_1K_USD'),
      BUDGET_CONSTANTS.DEFAULT_OUTPUT_COST_PER_1K_USD,
      0,
      1000,
      'AGENT_MODEL_OUTPUT_COST_PER_1K_USD',
    );
    this.outputCostMicroUsdPer1k = usdToMicroUsd(outputCostUsd);

    this.degradedModeEnabled =
      this.config.get<string>('AGENT_DEGRADED_MODE_ENABLED', 'true') !== 'false';
  }

  /**
   * Obtiene la instantánea del presupuesto del tenant para el período dado.
   */
  async getBudget(tenantId: string, periodKey?: string): Promise<AgentBudgetSnapshot> {
    const period = periodKey ?? getUtcPeriodKey();
    const budget = await this.budgetRepository.getOrCreateBudget(
      tenantId,
      period,
      this.monthlyBudgetMicroUsd,
      this.warnRatio,
      this.hardLimit,
    );

    const committed = budget.spentMicroUsd + budget.reservedMicroUsd;
    const availableMicroUsd = Math.max(0, budget.limitMicroUsd - committed);
    const isExhausted = committed >= budget.limitMicroUsd;
    const warnThreshold = Math.round(budget.limitMicroUsd * budget.warnRatio);
    const isWarning = budget.spentMicroUsd >= warnThreshold;

    return {
      tenantId: budget.tenantId,
      periodKey: budget.periodKey,
      limitMicroUsd: budget.limitMicroUsd,
      spentMicroUsd: budget.spentMicroUsd,
      reservedMicroUsd: budget.reservedMicroUsd,
      availableMicroUsd,
      warnRatio: budget.warnRatio,
      hardLimit: budget.hardLimit,
      isExhausted,
      isWarning,
    };
  }

  /**
   * Reserva atómica de saldo previo a invocar al LLM.
   * Evita sobreconsumos concurrentes con bloqueo condicional atómico en base de datos.
   */
  async reserve(params: ReserveParams): Promise<ReserveTokenBudgetResult> {
    const { tenantId, correlationId, estimatedCostMicroUsd } = params;
    const period = params.periodKey ?? getUtcPeriodKey();

    const result = await this.budgetRepository.reserveAtomic({
      tenantId,
      periodKey: period,
      correlationId,
      estimatedCostMicroUsd,
      defaultLimitMicroUsd: this.monthlyBudgetMicroUsd,
      defaultWarnRatio: this.warnRatio,
      defaultHardLimit: this.hardLimit,
    });

    const budget = result.budget;
    const committed = budget.spentMicroUsd + budget.reservedMicroUsd;
    const remainingMicroUsd = Math.max(0, budget.limitMicroUsd - committed);

    if (!result.granted) {
      if (result.reason === 'BUDGET_EXHAUSTED') {
        const isFirstExhaustion = await this.budgetRepository.recordBudgetExhaustedEvent(
          tenantId,
          period,
        );

        if (isFirstExhaustion) {
          this.logger.error(
            JSON.stringify({
              event: BUDGET_CONSTANTS.EVENT_BUDGET_EXHAUSTED,
              tenantId,
              periodKey: period,
              limitMicroUsd: budget.limitMicroUsd,
              spentMicroUsd: budget.spentMicroUsd,
              reservedMicroUsd: budget.reservedMicroUsd,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }

      return {
        granted: false,
        correlationId,
        reservedMicroUsd: 0,
        remainingMicroUsd,
        reason: result.reason ?? 'BUDGET_EXHAUSTED',
      };
    }

    const warnThreshold = Math.round(budget.limitMicroUsd * budget.warnRatio);
    if (committed >= warnThreshold) {
      this.logger.warn(
        JSON.stringify({
          event: 'agent.budget.warning',
          tenantId,
          periodKey: period,
          spentMicroUsd: budget.spentMicroUsd,
          reservedMicroUsd: budget.reservedMicroUsd,
          limitMicroUsd: budget.limitMicroUsd,
          warnRatio: budget.warnRatio,
          ratio: Number((committed / budget.limitMicroUsd).toFixed(4)),
        }),
      );
    }

    return {
      granted: true,
      correlationId,
      reservedMicroUsd: result.reservation?.estimatedCostMicroUsd ?? estimatedCostMicroUsd,
      remainingMicroUsd,
    };
  }

  /**
   * Liquidación posterior a la llamada del LLM.
   * Resta del reservado, suma al gasto real y registra el uso inmutable.
   */
  async settle(params: SettleParams): Promise<SettleTokenBudgetResult> {
    const {
      tenantId,
      correlationId,
      actualCostMicroUsd,
      promptTokens,
      completionTokens,
      model = BUDGET_CONSTANTS.DEFAULT_MODEL,
      conversationId,
      cacheHit = false,
      degraded = false,
    } = params;

    const period = params.periodKey ?? getUtcPeriodKey();

    const result = await this.budgetRepository.settleReservation({
      tenantId,
      periodKey: period,
      correlationId,
      actualCostMicroUsd,
      promptTokens,
      completionTokens,
      model,
      conversationId,
      cacheHit,
      degraded,
    });

    const budget = result.budget;
    const committed = budget.spentMicroUsd + budget.reservedMicroUsd;
    const remainingMicroUsd = Math.max(0, budget.limitMicroUsd - committed);

    // Reintento idempotente: la reserva ya estaba liquidada. No se suma consumo ni se
    // vuelve a emitir el warning de gasto; se devuelve el snapshot realmente persistido.
    if (result.alreadySettled) {
      const settledUsage = result.usage ?? null;
      const settledPromptTokens = settledUsage?.promptTokens ?? promptTokens;
      const settledCompletionTokens = settledUsage?.completionTokens ?? completionTokens;
      const settledCostMicroUsd = settledUsage?.costMicroUsd ?? actualCostMicroUsd;

      const settledConsumption: AgentChatConsumption = {
        promptTokens: settledPromptTokens,
        completionTokens: settledCompletionTokens,
        totalTokens: settledPromptTokens + settledCompletionTokens,
        costMicroUsd: settledCostMicroUsd,
        cacheHit: settledUsage?.cacheHit ?? cacheHit,
        degraded: settledUsage?.degraded ?? degraded,
        remainingMicroUsd,
      };

      return {
        success: true,
        correlationId,
        actualCostMicroUsd: settledCostMicroUsd,
        remainingMicroUsd,
        settled: true,
        alreadySettled: true,
        consumption: settledConsumption,
      };
    }

    const warnThreshold = Math.round(budget.limitMicroUsd * budget.warnRatio);
    if (budget.spentMicroUsd >= warnThreshold) {
      this.logger.warn(
        JSON.stringify({
          event: 'agent.budget.warning',
          tenantId,
          periodKey: period,
          spentMicroUsd: budget.spentMicroUsd,
          limitMicroUsd: budget.limitMicroUsd,
          warnRatio: budget.warnRatio,
          ratio: Number((budget.spentMicroUsd / budget.limitMicroUsd).toFixed(4)),
        }),
      );
    }

    const consumption: AgentChatConsumption = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costMicroUsd: actualCostMicroUsd,
      cacheHit,
      degraded,
      remainingMicroUsd,
    };

    return {
      success: true,
      correlationId,
      actualCostMicroUsd,
      remainingMicroUsd,
      settled: true,
      alreadySettled: false,
      consumption,
    };
  }

  /**
   * Liberación de saldo reservado en caso de fallo, cancelación o timeout.
   */
  async release(params: ReleaseParams): Promise<ReleaseTokenBudgetResult> {
    const { tenantId, correlationId } = params;
    const period = params.periodKey ?? getUtcPeriodKey();

    const result = await this.budgetRepository.releaseReservation({
      tenantId,
      periodKey: period,
      correlationId,
    });

    const budget = result.budget;
    const remainingMicroUsd = budget
      ? Math.max(0, budget.limitMicroUsd - (budget.spentMicroUsd + budget.reservedMicroUsd))
      : 0;

    return {
      success: true,
      correlationId,
      releasedMicroUsd: result.releasedMicroUsd,
      remainingMicroUsd,
    };
  }

  /**
   * Consulta del resumen de consumo mensual del tenant.
   */
  async getUsage(tenantId: string, periodKey?: string): Promise<AgentUsageSummary> {
    const period = periodKey ?? getUtcPeriodKey();
    return this.budgetRepository.getUsageSummary(tenantId, period);
  }

  /**
   * Genera una respuesta estructurada para modo degradado sin LLM.
   */
  handleDegradedResponse(reason: AgentDegradationReason, tenantId: string): AgentDegradedResponse {
    this.logger.warn(`Respuesta degradada emitida para tenant ${tenantId}. Razón: ${reason}`);

    const isExhausted = reason === AgentDegradationReason.BUDGET_EXHAUSTED;

    return {
      degraded: true,
      reason,
      message: isExhausted
        ? 'El presupuesto mensual de tokens para su organización ha alcanzado su límite. Las consultas con Inteligencia Artificial están pausadas hasta el próximo período de facturación o hasta que su administrador amplíe el presupuesto.'
        : 'El proveedor de Inteligencia Artificial no se encuentra disponible temporalmente. Por favor intente nuevamente en unos minutos.',
      suggestions: [
        'Consulte sus saldos y estados financieros directamente en el módulo de Finanzas.',
        'Revise las transacciones bancarias sincronizadas en el módulo de Conciliación.',
        'Contacte al administrador de su organización para ampliar el presupuesto de tokens asignado.',
      ],
    };
  }

  /**
   * Calcula el coste exacto en micro-USD a partir del número de tokens (ADR-003).
   */
  calculateCost(promptTokens: number, completionTokens: number): number {
    return calculateTokenCostMicroUsd(
      promptTokens,
      completionTokens,
      this.inputCostMicroUsdPer1k,
      this.outputCostMicroUsdPer1k,
    );
  }

  /**
   * Estima el coste en micro-USD para una reserva previa.
   */
  estimateCost(estimatedPromptTokens: number, maxCompletionTokens = 1000): number {
    return this.calculateCost(estimatedPromptTokens, maxCompletionTokens);
  }

  isDegradedModeEnabled(): boolean {
    return this.degradedModeEnabled;
  }
}
