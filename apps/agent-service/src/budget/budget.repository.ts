import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { AgentDatabaseService } from '../database/database.service';
import {
  agentBudgetEvents,
  agentTokenBudgets,
  agentTokenReservations,
  agentTokenUsage,
  type AgentTokenBudget,
  type AgentTokenReservation,
  type AgentTokenUsage,
  type NewAgentTokenUsage,
} from '../database/schema';
import { BUDGET_CONSTANTS } from './budget.constants';
import type {
  IBudgetRepository,
  ReleaseReservationParams,
  ReleaseReservationResult,
  ReserveAtomicParams,
  ReserveAtomicResult,
  SettleReservationParams,
  SettleReservationResult,
} from './budget.repository.interface';
import type { AgentUsageSummary } from '@mybusiness/contracts';

@Injectable()
export class BudgetRepository implements IBudgetRepository {
  constructor(private readonly database: AgentDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async getOrCreateBudget(
    tenantId: string,
    periodKey: string,
    defaultLimitMicroUsd: number,
    defaultWarnRatio: number,
    defaultHardLimit: boolean,
  ): Promise<AgentTokenBudget> {
    const existing = await this.findBudget(tenantId, periodKey);
    if (existing) {
      return existing;
    }

    const [created] = await this.db
      .insert(agentTokenBudgets)
      .values({
        tenantId,
        periodKey,
        limitMicroUsd: defaultLimitMicroUsd,
        spentMicroUsd: 0,
        reservedMicroUsd: 0,
        warnRatio: defaultWarnRatio,
        hardLimit: defaultHardLimit,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      return created;
    }

    const fetched = await this.findBudget(tenantId, periodKey);
    if (!fetched) {
      throw new Error(
        `No se pudo inicializar o recuperar el presupuesto para el tenant ${tenantId}`,
      );
    }
    return fetched;
  }

  async findBudget(tenantId: string, periodKey: string): Promise<AgentTokenBudget | null> {
    const [found] = await this.db
      .select()
      .from(agentTokenBudgets)
      .where(
        and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
      )
      .limit(1);

    return found ?? null;
  }

  async reserveAtomic(params: ReserveAtomicParams): Promise<ReserveAtomicResult> {
    const {
      tenantId,
      periodKey,
      correlationId,
      estimatedCostMicroUsd,
      defaultLimitMicroUsd,
      defaultWarnRatio,
      defaultHardLimit,
    } = params;

    // 1. Idempotencia: Verificar si ya existe una reserva con este correlationId
    const existingReservation = await this.findReservation(tenantId, correlationId);
    if (existingReservation) {
      const budget = await this.getOrCreateBudget(
        tenantId,
        periodKey,
        defaultLimitMicroUsd,
        defaultWarnRatio,
        defaultHardLimit,
      );
      if (existingReservation.status === 'ACTIVE') {
        return { granted: true, budget, reservation: existingReservation };
      }
      return {
        granted: false,
        budget,
        reason: `RESERVATION_ALREADY_${existingReservation.status}`,
      };
    }

    // 2. Asegurar que existe la fila de presupuesto para este período
    await this.getOrCreateBudget(
      tenantId,
      periodKey,
      defaultLimitMicroUsd,
      defaultWarnRatio,
      defaultHardLimit,
    );

    // 3. UPDATE condicional atómico con bloqueo a nivel de fila en Postgres.
    // Garantiza que la suma de spent + reserved + estimated nunca supere el límite si hard_limit = true.
    const [updatedBudget] = await this.db
      .update(agentTokenBudgets)
      .set({
        reservedMicroUsd: sql`${agentTokenBudgets.reservedMicroUsd} + ${estimatedCostMicroUsd}`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(agentTokenBudgets.tenantId, tenantId),
          eq(agentTokenBudgets.periodKey, periodKey),
          sql`(${agentTokenBudgets.spentMicroUsd} + ${agentTokenBudgets.reservedMicroUsd} + ${estimatedCostMicroUsd} <= ${agentTokenBudgets.limitMicroUsd} OR ${agentTokenBudgets.hardLimit} = false)`,
        ),
      )
      .returning();

    if (!updatedBudget) {
      const currentBudget = await this.getOrCreateBudget(
        tenantId,
        periodKey,
        defaultLimitMicroUsd,
        defaultWarnRatio,
        defaultHardLimit,
      );
      return {
        granted: false,
        budget: currentBudget,
        reason: 'BUDGET_EXHAUSTED',
      };
    }

    // 4. Registrar la reserva con estado ACTIVE
    const [reservation] = await this.db
      .insert(agentTokenReservations)
      .values({
        tenantId,
        correlationId,
        estimatedCostMicroUsd,
        status: 'ACTIVE',
      })
      .returning();

    return {
      granted: true,
      budget: updatedBudget,
      reservation,
    };
  }

  async settleReservation(params: SettleReservationParams): Promise<SettleReservationResult> {
    const {
      tenantId,
      periodKey,
      correlationId,
      actualCostMicroUsd,
      promptTokens,
      completionTokens,
      model,
      conversationId,
      cacheHit = false,
      degraded = false,
    } = params;

    const reservation = await this.findReservation(tenantId, correlationId);
    if (!reservation) {
      throw new Error(`Reserva no encontrada para correlationId: ${correlationId}`);
    }

    const estimated = reservation.status === 'ACTIVE' ? reservation.estimatedCostMicroUsd : 0;

    // 1. Restar el estimado del reservado y sumar el coste real al gastado
    const [updatedBudget] = await this.db
      .update(agentTokenBudgets)
      .set({
        reservedMicroUsd: sql`GREATEST(0, ${agentTokenBudgets.reservedMicroUsd} - ${estimated})`,
        spentMicroUsd: sql`${agentTokenBudgets.spentMicroUsd} + ${actualCostMicroUsd}`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
      )
      .returning();

    // 2. Marcar la reserva como SETTLED
    const [updatedReservation] = await this.db
      .update(agentTokenReservations)
      .set({
        status: 'SETTLED',
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(agentTokenReservations.tenantId, tenantId),
          eq(agentTokenReservations.correlationId, correlationId),
        ),
      )
      .returning();

    // 3. Insertar registro de uso inmutable
    const [usage] = await this.db
      .insert(agentTokenUsage)
      .values({
        tenantId,
        conversationId,
        model,
        promptTokens,
        completionTokens,
        costMicroUsd: actualCostMicroUsd,
        cacheHit,
        degraded,
      })
      .returning();

    return {
      budget: updatedBudget,
      reservation: updatedReservation,
      usage,
    };
  }

  async releaseReservation(params: ReleaseReservationParams): Promise<ReleaseReservationResult> {
    const { tenantId, periodKey, correlationId } = params;

    const reservation = await this.findReservation(tenantId, correlationId);
    if (!reservation) {
      return { releasedMicroUsd: 0 };
    }

    if (reservation.status !== 'ACTIVE') {
      return { releasedMicroUsd: 0 };
    }

    const estimated = reservation.estimatedCostMicroUsd;

    const [updatedBudget] = await this.db
      .update(agentTokenBudgets)
      .set({
        reservedMicroUsd: sql`GREATEST(0, ${agentTokenBudgets.reservedMicroUsd} - ${estimated})`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
      )
      .returning();

    await this.db
      .update(agentTokenReservations)
      .set({
        status: 'RELEASED',
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(agentTokenReservations.tenantId, tenantId),
          eq(agentTokenReservations.correlationId, correlationId),
        ),
      );

    return {
      budget: updatedBudget,
      releasedMicroUsd: estimated,
    };
  }

  async findReservation(
    tenantId: string,
    correlationId: string,
  ): Promise<AgentTokenReservation | null> {
    const [found] = await this.db
      .select()
      .from(agentTokenReservations)
      .where(
        and(
          eq(agentTokenReservations.tenantId, tenantId),
          eq(agentTokenReservations.correlationId, correlationId),
        ),
      )
      .limit(1);

    return found ?? null;
  }

  async recordUsage(params: NewAgentTokenUsage): Promise<AgentTokenUsage> {
    const [inserted] = await this.db.insert(agentTokenUsage).values(params).returning();
    return inserted;
  }

  async getUsageSummary(tenantId: string, periodKey: string): Promise<AgentUsageSummary> {
    const [yearStr, monthStr] = periodKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

    const [row] = await this.db
      .select({
        totalRequests: sql<number>`count(*)::int`,
        promptTokens: sql<number>`coalesce(sum(${agentTokenUsage.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${agentTokenUsage.completionTokens}), 0)::int`,
        totalCostMicroUsd: sql<number>`coalesce(sum(${agentTokenUsage.costMicroUsd}), 0)::bigint`,
        cacheHits: sql<number>`coalesce(sum(case when ${agentTokenUsage.cacheHit} then 1 else 0 end), 0)::int`,
        degradedRequests: sql<number>`coalesce(sum(case when ${agentTokenUsage.degraded} then 1 else 0 end), 0)::int`,
      })
      .from(agentTokenUsage)
      .where(
        and(
          eq(agentTokenUsage.tenantId, tenantId),
          gte(agentTokenUsage.createdAt, startOfMonth),
          lt(agentTokenUsage.createdAt, endOfMonth),
        ),
      );

    const totalRequests = Number(row?.totalRequests ?? 0);
    const promptTokens = Number(row?.promptTokens ?? 0);
    const completionTokens = Number(row?.completionTokens ?? 0);
    const totalTokens = promptTokens + completionTokens;
    const totalCostMicroUsd = Number(row?.totalCostMicroUsd ?? 0);
    const cacheHits = Number(row?.cacheHits ?? 0);
    const degradedRequests = Number(row?.degradedRequests ?? 0);
    const cacheHitRate = totalRequests > 0 ? Number((cacheHits / totalRequests).toFixed(4)) : 0;

    return {
      tenantId,
      periodKey,
      totalRequests,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostMicroUsd,
      cacheHits,
      cacheHitRate,
      degradedRequests,
    };
  }

  async recordBudgetExhaustedEvent(tenantId: string, periodKey: string): Promise<boolean> {
    const inserted = await this.db
      .insert(agentBudgetEvents)
      .values({
        tenantId,
        periodKey,
        eventType: BUDGET_CONSTANTS.EVENT_BUDGET_EXHAUSTED,
      })
      .onConflictDoNothing()
      .returning();

    return inserted.length > 0;
  }
}
