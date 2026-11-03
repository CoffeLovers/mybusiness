import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { AgentDatabase } from '../database/client';
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

/**
 * Cliente mínimo compartido por la conexión raíz y las transacciones de Drizzle.
 * Permite reutilizar los helpers dentro y fuera de `db.transaction`.
 */
type BudgetDb = PgDatabase<NodePgQueryResultHKT, Record<string, unknown>>;

@Injectable()
export class BudgetRepository implements IBudgetRepository {
  constructor(private readonly database: AgentDatabaseService) {}

  private get db(): AgentDatabase {
    return this.database.db;
  }

  /**
   * Normaliza la conexión (raíz o transacción) al tipo estructural que usan los helpers.
   */
  private client(db: AgentDatabase | BudgetDb): BudgetDb {
    return db as BudgetDb;
  }

  async getOrCreateBudget(
    tenantId: string,
    periodKey: string,
    defaultLimitMicroUsd: number,
    defaultWarnRatio: number,
    defaultHardLimit: boolean,
  ): Promise<AgentTokenBudget> {
    return this.getOrCreateBudgetWith(
      this.client(this.db),
      tenantId,
      periodKey,
      defaultLimitMicroUsd,
      defaultWarnRatio,
      defaultHardLimit,
    );
  }

  async findBudget(tenantId: string, periodKey: string): Promise<AgentTokenBudget | null> {
    return this.findBudgetWith(this.client(this.db), tenantId, periodKey);
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

    return this.db.transaction(async (tx) => {
      const db = this.client(tx);

      // 1. Asegurar la fila de presupuesto del período dentro de la misma transacción.
      const budget = await this.getOrCreateBudgetWith(
        db,
        tenantId,
        periodKey,
        defaultLimitMicroUsd,
        defaultWarnRatio,
        defaultHardLimit,
      );

      // 2. Insertar la reserva ANTES de tocar el saldo. El UNIQUE (tenant, correlation)
      // decide el ganador de la carrera; nunca se incrementa reserved sin fila propia.
      const [reservation] = await db
        .insert(agentTokenReservations)
        .values({
          tenantId,
          correlationId,
          estimatedCostMicroUsd,
          status: 'ACTIVE',
        })
        .onConflictDoNothing({
          target: [agentTokenReservations.tenantId, agentTokenReservations.correlationId],
        })
        .returning();

      // 3. Conflicto: la reserva ya existía. Resolver de forma idempotente sin sumar saldo.
      if (!reservation) {
        const existing = await this.findReservationWith(db, tenantId, correlationId);
        if (!existing) {
          throw new Error(
            `Conflicto de reserva sin fila recuperable para correlationId: ${correlationId}`,
          );
        }
        if (existing.status === 'ACTIVE') {
          return { granted: true, budget, reservation: existing };
        }
        return {
          granted: false,
          budget,
          reason: `RESERVATION_ALREADY_${existing.status}`,
        };
      }

      // 4. UPDATE condicional del presupuesto (bloqueo de fila en Postgres).
      const [updatedBudget] = await db
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

      // 5. Sin cupo: marcar la reserva como REJECTED. Sin incremento y sin fuga de saldo.
      if (!updatedBudget) {
        await db
          .update(agentTokenReservations)
          .set({ status: 'REJECTED', updatedAt: sql`NOW()` })
          .where(
            and(
              eq(agentTokenReservations.tenantId, tenantId),
              eq(agentTokenReservations.correlationId, correlationId),
              eq(agentTokenReservations.status, 'ACTIVE'),
            ),
          );

        const budgetActual = (await this.findBudgetWith(db, tenantId, periodKey)) ?? budget;
        return {
          granted: false,
          budget: budgetActual,
          reason: 'BUDGET_EXHAUSTED',
        };
      }

      return { granted: true, budget: updatedBudget, reservation };
    });
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

    return this.db.transaction(async (tx) => {
      const db = this.client(tx);

      // 1. Transición atómica ACTIVE -> SETTLED: solo un reintento puede ganar.
      const [settled] = await db
        .update(agentTokenReservations)
        .set({ status: 'SETTLED', updatedAt: sql`NOW()` })
        .where(
          and(
            eq(agentTokenReservations.tenantId, tenantId),
            eq(agentTokenReservations.correlationId, correlationId),
            eq(agentTokenReservations.status, 'ACTIVE'),
          ),
        )
        .returning();

      // 2. Sin fila: o ya estaba liquidada (idempotente) o no es liquidable.
      if (!settled) {
        const existing = await this.findReservationWith(db, tenantId, correlationId);
        if (!existing) {
          throw new Error('Reserva no liquidable: NOT_FOUND');
        }
        if (existing.status === 'SETTLED') {
          const budget = await this.requireBudget(db, tenantId, periodKey);
          const usage = await this.findUsageByCorrelationWith(db, tenantId, correlationId);
          return {
            alreadySettled: true,
            budget,
            reservation: existing,
            usage: usage ?? null,
          };
        }
        throw new Error(`Reserva no liquidable: ${existing.status}`);
      }

      // 3. Consumo real: liberar el estimado y sumar el coste efectivo.
      const [updatedBudget] = await db
        .update(agentTokenBudgets)
        .set({
          reservedMicroUsd: sql`GREATEST(0, ${agentTokenBudgets.reservedMicroUsd} - ${settled.estimatedCostMicroUsd})`,
          spentMicroUsd: sql`${agentTokenBudgets.spentMicroUsd} + ${actualCostMicroUsd}`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
        )
        .returning();

      if (!updatedBudget) {
        throw new Error(`Presupuesto no encontrado para el tenant ${tenantId} (${periodKey})`);
      }

      // 4. Uso inmutable; el UNIQUE parcial (tenant, correlation) actúa como defensa extra.
      const [insertedUsage] = await db
        .insert(agentTokenUsage)
        .values({
          tenantId,
          correlationId,
          conversationId,
          model,
          promptTokens,
          completionTokens,
          costMicroUsd: actualCostMicroUsd,
          cacheHit,
          degraded,
        })
        .onConflictDoNothing({
          target: [agentTokenUsage.tenantId, agentTokenUsage.correlationId],
          // El índice único es parcial: Postgres exige el predicado para poder inferirlo.
          where: sql`${agentTokenUsage.correlationId} IS NOT NULL`,
        })
        .returning();

      const usage =
        insertedUsage ??
        (await this.findUsageByCorrelationWith(db, tenantId, correlationId)) ??
        null;

      return {
        alreadySettled: false,
        budget: updatedBudget,
        reservation: settled,
        usage,
      };
    });
  }

  async releaseReservation(params: ReleaseReservationParams): Promise<ReleaseReservationResult> {
    const { tenantId, periodKey, correlationId } = params;

    return this.db.transaction(async (tx) => {
      const db = this.client(tx);

      // Transición atómica ACTIVE -> RELEASED: solo un proceso resta el estimado.
      const [released] = await db
        .update(agentTokenReservations)
        .set({ status: 'RELEASED', updatedAt: sql`NOW()` })
        .where(
          and(
            eq(agentTokenReservations.tenantId, tenantId),
            eq(agentTokenReservations.correlationId, correlationId),
            eq(agentTokenReservations.status, 'ACTIVE'),
          ),
        )
        .returning();

      if (!released) {
        return { releasedMicroUsd: 0 };
      }

      const [updatedBudget] = await db
        .update(agentTokenBudgets)
        .set({
          reservedMicroUsd: sql`GREATEST(0, ${agentTokenBudgets.reservedMicroUsd} - ${released.estimatedCostMicroUsd})`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
        )
        .returning();

      return {
        budget: updatedBudget,
        releasedMicroUsd: released.estimatedCostMicroUsd,
      };
    });
  }

  async findReservation(
    tenantId: string,
    correlationId: string,
  ): Promise<AgentTokenReservation | null> {
    return this.findReservationWith(this.client(this.db), tenantId, correlationId);
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

  // ---------------------------------------------------------------------------
  // Helpers reutilizables dentro y fuera de transacción
  // ---------------------------------------------------------------------------

  private async getOrCreateBudgetWith(
    db: BudgetDb,
    tenantId: string,
    periodKey: string,
    defaultLimitMicroUsd: number,
    defaultWarnRatio: number,
    defaultHardLimit: boolean,
  ): Promise<AgentTokenBudget> {
    const existing = await this.findBudgetWith(db, tenantId, periodKey);
    if (existing) {
      return existing;
    }

    const [created] = await db
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

    const fetched = await this.findBudgetWith(db, tenantId, periodKey);
    if (!fetched) {
      throw new Error(
        `No se pudo inicializar o recuperar el presupuesto para el tenant ${tenantId}`,
      );
    }
    return fetched;
  }

  private async findBudgetWith(
    db: BudgetDb,
    tenantId: string,
    periodKey: string,
  ): Promise<AgentTokenBudget | null> {
    const [found] = await db
      .select()
      .from(agentTokenBudgets)
      .where(
        and(eq(agentTokenBudgets.tenantId, tenantId), eq(agentTokenBudgets.periodKey, periodKey)),
      )
      .limit(1);

    return found ?? null;
  }

  private async requireBudget(
    db: BudgetDb,
    tenantId: string,
    periodKey: string,
  ): Promise<AgentTokenBudget> {
    const budget = await this.findBudgetWith(db, tenantId, periodKey);
    if (!budget) {
      throw new Error(`Presupuesto no encontrado para el tenant ${tenantId} (${periodKey})`);
    }
    return budget;
  }

  private async findReservationWith(
    db: BudgetDb,
    tenantId: string,
    correlationId: string,
  ): Promise<AgentTokenReservation | null> {
    const [found] = await db
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

  private async findUsageByCorrelationWith(
    db: BudgetDb,
    tenantId: string,
    correlationId: string,
  ): Promise<AgentTokenUsage | null> {
    const [found] = await db
      .select()
      .from(agentTokenUsage)
      .where(
        and(
          eq(agentTokenUsage.tenantId, tenantId),
          eq(agentTokenUsage.correlationId, correlationId),
        ),
      )
      .limit(1);

    return found ?? null;
  }
}
