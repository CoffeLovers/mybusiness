import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentDegradationReason } from '@mybusiness/contracts';
import { BudgetService } from '../src/budget/budget.service';
import type {
  IBudgetRepository,
  ReleaseReservationParams,
  ReleaseReservationResult,
  ReserveAtomicParams,
  ReserveAtomicResult,
  SettleReservationParams,
  SettleReservationResult,
} from '../src/budget/budget.repository.interface';
import type {
  AgentTokenBudget,
  AgentTokenReservation,
  AgentTokenUsage,
  NewAgentTokenUsage,
} from '../src/database/schema';

/**
 * Fake en memoria de IBudgetRepository que simula el bloqueo a nivel de fila de PostgreSQL
 * mediante una cadena de promesas secuenciales (mutex por tenant/periodo).
 */
class FakeBudgetRepository implements IBudgetRepository {
  budgets: Map<string, AgentTokenBudget> = new Map();
  reservations: Map<string, AgentTokenReservation> = new Map();
  usages: AgentTokenUsage[] = [];
  events: Set<string> = new Set();

  private rowMutex: Promise<void> = Promise.resolve();

  async getOrCreateBudget(
    tenantId: string,
    periodKey: string,
    defaultLimitMicroUsd: number,
    defaultWarnRatio: number,
    defaultHardLimit: boolean,
  ): Promise<AgentTokenBudget> {
    const key = `${tenantId}:${periodKey}`;
    let b = this.budgets.get(key);
    if (!b) {
      b = {
        id: `budget-${Math.random().toString(36).substring(2, 9)}`,
        tenantId,
        periodKey,
        limitMicroUsd: defaultLimitMicroUsd,
        spentMicroUsd: 0,
        reservedMicroUsd: 0,
        warnRatio: defaultWarnRatio,
        hardLimit: defaultHardLimit,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.budgets.set(key, b);
    }
    return { ...b };
  }

  async findBudget(tenantId: string, periodKey: string): Promise<AgentTokenBudget | null> {
    const b = this.budgets.get(`${tenantId}:${periodKey}`);
    return b ? { ...b } : null;
  }

  async reserveAtomic(params: ReserveAtomicParams): Promise<ReserveAtomicResult> {
    return new Promise((resolve) => {
      this.rowMutex = this.rowMutex.then(async () => {
        const resKey = `${params.tenantId}:${params.correlationId}`;
        const existingRes = this.reservations.get(resKey);
        const budgetKey = `${params.tenantId}:${params.periodKey}`;

        let budget = this.budgets.get(budgetKey);
        if (!budget) {
          budget = await this.getOrCreateBudget(
            params.tenantId,
            params.periodKey,
            params.defaultLimitMicroUsd,
            params.defaultWarnRatio,
            params.defaultHardLimit,
          );
          this.budgets.set(budgetKey, budget);
        }

        if (existingRes) {
          if (existingRes.status === 'ACTIVE') {
            resolve({ granted: true, budget: { ...budget }, reservation: { ...existingRes } });
            return;
          }
          resolve({
            granted: false,
            budget: { ...budget },
            reason: `RESERVATION_ALREADY_${existingRes.status}`,
          });
          return;
        }

        const committed = budget.spentMicroUsd + budget.reservedMicroUsd;
        if (budget.hardLimit && committed + params.estimatedCostMicroUsd > budget.limitMicroUsd) {
          resolve({ granted: false, budget: { ...budget }, reason: 'BUDGET_EXHAUSTED' });
          return;
        }

        budget.reservedMicroUsd += params.estimatedCostMicroUsd;
        budget.updatedAt = new Date();

        const reservation: AgentTokenReservation = {
          id: `res-${Math.random().toString(36).substring(2, 9)}`,
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          estimatedCostMicroUsd: params.estimatedCostMicroUsd,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.reservations.set(resKey, reservation);

        resolve({ granted: true, budget: { ...budget }, reservation: { ...reservation } });
      });
    });
  }

  async settleReservation(params: SettleReservationParams): Promise<SettleReservationResult> {
    return new Promise((resolve, reject) => {
      this.rowMutex = this.rowMutex.then(async () => {
        const resKey = `${params.tenantId}:${params.correlationId}`;
        const reservation = this.reservations.get(resKey);
        if (!reservation) {
          reject(new Error(`Reserva no encontrada: ${params.correlationId}`));
          return;
        }

        const budgetKey = `${params.tenantId}:${params.periodKey}`;
        let budget = this.budgets.get(budgetKey);
        if (!budget) {
          budget = await this.getOrCreateBudget(
            params.tenantId,
            params.periodKey,
            50_000_000,
            0.8,
            true,
          );
          this.budgets.set(budgetKey, budget);
        }

        // Reintento idempotente: ya liquidada, no se vuelve a sumar ni a insertar uso.
        if (reservation.status === 'SETTLED') {
          const existingUsage =
            this.usages.find(
              (u) => u.tenantId === params.tenantId && u.correlationId === params.correlationId,
            ) ?? null;
          resolve({
            alreadySettled: true,
            budget: { ...budget },
            reservation: { ...reservation },
            usage: existingUsage,
          });
          return;
        }

        if (reservation.status !== 'ACTIVE') {
          reject(new Error(`Reserva no liquidable: ${reservation.status}`));
          return;
        }

        const estimated = reservation.estimatedCostMicroUsd;
        budget.reservedMicroUsd = Math.max(0, budget.reservedMicroUsd - estimated);
        budget.spentMicroUsd += params.actualCostMicroUsd;
        budget.updatedAt = new Date();

        reservation.status = 'SETTLED';
        reservation.updatedAt = new Date();

        const usage: AgentTokenUsage = {
          id: `usage-${Math.random().toString(36).substring(2, 9)}`,
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          conversationId: params.conversationId ?? null,
          model: params.model,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          costMicroUsd: params.actualCostMicroUsd,
          cacheHit: params.cacheHit ?? false,
          degraded: params.degraded ?? false,
          createdAt: new Date(),
        };
        this.usages.push(usage);

        resolve({
          alreadySettled: false,
          budget: { ...budget },
          reservation: { ...reservation },
          usage,
        });
      });
    });
  }

  async releaseReservation(params: ReleaseReservationParams): Promise<ReleaseReservationResult> {
    return new Promise((resolve) => {
      this.rowMutex = this.rowMutex.then(async () => {
        const resKey = `${params.tenantId}:${params.correlationId}`;
        const reservation = this.reservations.get(resKey);
        if (!reservation || reservation.status !== 'ACTIVE') {
          resolve({ releasedMicroUsd: 0 });
          return;
        }

        const budgetKey = `${params.tenantId}:${params.periodKey}`;
        const budget = this.budgets.get(budgetKey);
        const estimated = reservation.estimatedCostMicroUsd;

        if (budget) {
          budget.reservedMicroUsd = Math.max(0, budget.reservedMicroUsd - estimated);
          budget.updatedAt = new Date();
        }

        reservation.status = 'RELEASED';
        reservation.updatedAt = new Date();

        resolve({
          budget: budget ? { ...budget } : undefined,
          releasedMicroUsd: estimated,
        });
      });
    });
  }

  async findReservation(
    tenantId: string,
    correlationId: string,
  ): Promise<AgentTokenReservation | null> {
    const res = this.reservations.get(`${tenantId}:${correlationId}`);
    return res ? { ...res } : null;
  }

  async recordUsage(params: NewAgentTokenUsage): Promise<AgentTokenUsage> {
    const usage: AgentTokenUsage = {
      id: `usage-${Math.random().toString(36).substring(2, 9)}`,
      tenantId: params.tenantId,
      correlationId: params.correlationId ?? null,
      conversationId: params.conversationId ?? null,
      model: params.model,
      promptTokens: params.promptTokens ?? 0,
      completionTokens: params.completionTokens ?? 0,
      costMicroUsd: params.costMicroUsd ?? 0,
      cacheHit: params.cacheHit ?? false,
      degraded: params.degraded ?? false,
      createdAt: new Date(),
    };
    this.usages.push(usage);
    return usage;
  }

  async getUsageSummary(tenantId: string, periodKey: string) {
    const tenantUsages = this.usages.filter((u) => u.tenantId === tenantId);
    const totalRequests = tenantUsages.length;
    const promptTokens = tenantUsages.reduce((sum, u) => sum + u.promptTokens, 0);
    const completionTokens = tenantUsages.reduce((sum, u) => sum + u.completionTokens, 0);
    const totalTokens = promptTokens + completionTokens;
    const totalCostMicroUsd = tenantUsages.reduce((sum, u) => sum + u.costMicroUsd, 0);
    const cacheHits = tenantUsages.filter((u) => u.cacheHit).length;
    const degradedRequests = tenantUsages.filter((u) => u.degraded).length;
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
    const key = `${tenantId}:${periodKey}:agent.budget.exhausted`;
    if (this.events.has(key)) {
      return false;
    }
    this.events.add(key);
    return true;
  }
}

describe('BudgetService (SF3-03 Token Governance)', () => {
  let fakeRepo: FakeBudgetRepository;
  let service: BudgetService;
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const currentPeriod = '2026-11';

  beforeEach(() => {
    fakeRepo = new FakeBudgetRepository();
    const mockConfig = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        switch (key) {
          case 'AGENT_TOKEN_BUDGET_USD_MONTHLY':
            return 10; // 10 USD = 10,000,000 micro-USD para pruebas precisas
          case 'AGENT_BUDGET_WARN_RATIO':
            return 0.8;
          case 'AGENT_MODEL_INPUT_COST_PER_1K_USD':
            return 0.0015;
          case 'AGENT_MODEL_OUTPUT_COST_PER_1K_USD':
            return 0.002;
          case 'AGENT_DEGRADED_MODE_ENABLED':
            return 'true';
          default:
            return defaultValue;
        }
      }),
    } as unknown as ConfigService;

    service = new BudgetService(fakeRepo, mockConfig);
  });

  describe('Cálculo de costes (ADR-003 Dinero y Unidades)', () => {
    it('debe calcular el coste exacto en micro-USD sin floats', () => {
      // Input: 1000 tokens a 0.0015 USD/1K = 1,500 micro-USD
      // Output: 500 tokens a 0.0020 USD/1K = 1,000 micro-USD
      // Total = 2,500 micro-USD
      const cost = service.calculateCost(1000, 500);
      expect(cost).toBe(2500);
      expect(Number.isInteger(cost)).toBe(true);
    });

    it('debe redondear hacia arriba (ceil) en fracciones de micro-USD', () => {
      // 1 prompt token: ceil((1 * 1500) / 1000) = ceil(1.5) = 2 micro-USD
      const cost = service.calculateCost(1, 0);
      expect(cost).toBe(2);
    });
  });

  describe('Validación estricta de configuración (fallo en el arranque)', () => {
    function buildWith(value: unknown): BudgetService {
      const config = {
        get: vi.fn((key: string, defaultValue?: unknown) =>
          key === 'AGENT_TOKEN_BUDGET_USD_MONTHLY' ? value : defaultValue,
        ),
      } as unknown as ConfigService;
      return new BudgetService(fakeRepo, config);
    }

    it('no debe arrancar con un presupuesto mensual no numérico', () => {
      expect(() => buildWith('no-es-un-numero')).toThrow(
        /Configuración inválida: AGENT_TOKEN_BUDGET_USD_MONTHLY/,
      );
    });

    it('no debe arrancar con un presupuesto mensual por debajo del mínimo', () => {
      expect(() => buildWith(0)).toThrow(/AGENT_TOKEN_BUDGET_USD_MONTHLY/);
    });

    it('no debe arrancar con un presupuesto mensual por encima del máximo', () => {
      expect(() => buildWith(2_000_000)).toThrow(/AGENT_TOKEN_BUDGET_USD_MONTHLY/);
    });
  });

  describe('Presupuesto inicial e instantánea', () => {
    it('debe inicializar un presupuesto mensual con 10,000,000 micro-USD y disponible total', async () => {
      const budget = await service.getBudget(tenantA, currentPeriod);

      expect(budget.tenantId).toBe(tenantA);
      expect(budget.periodKey).toBe(currentPeriod);
      expect(budget.limitMicroUsd).toBe(10_000_000);
      expect(budget.spentMicroUsd).toBe(0);
      expect(budget.reservedMicroUsd).toBe(0);
      expect(budget.availableMicroUsd).toBe(10_000_000);
      expect(budget.isExhausted).toBe(false);
      expect(budget.isWarning).toBe(false);
    });
  });

  describe('Ciclo completo: Reserva, Liquidación y Liberación', () => {
    it('debe reservar saldo de forma atómica y actualizar el disponible', async () => {
      const res = await service.reserve({
        tenantId: tenantA,
        correlationId: 'req-001',
        estimatedCostMicroUsd: 2_000_000,
        periodKey: currentPeriod,
      });

      expect(res.granted).toBe(true);
      expect(res.reservedMicroUsd).toBe(2_000_000);
      expect(res.remainingMicroUsd).toBe(8_000_000);

      const budget = await service.getBudget(tenantA, currentPeriod);
      expect(budget.reservedMicroUsd).toBe(2_000_000);
      expect(budget.spentMicroUsd).toBe(0);
      expect(budget.availableMicroUsd).toBe(8_000_000);
    });

    it('debe liquidar la reserva sumando al gasto real y liberando lo reservado', async () => {
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'req-002',
        estimatedCostMicroUsd: 2_000_000,
        periodKey: currentPeriod,
      });

      const settleRes = await service.settle({
        tenantId: tenantA,
        correlationId: 'req-002',
        actualCostMicroUsd: 1_800_000,
        promptTokens: 800,
        completionTokens: 300,
        periodKey: currentPeriod,
      });

      expect(settleRes.success).toBe(true);
      expect(settleRes.actualCostMicroUsd).toBe(1_800_000);
      expect(settleRes.consumption.remainingMicroUsd).toBe(8_200_000);
      expect(settleRes.consumption.totalTokens).toBe(1100);

      const budget = await service.getBudget(tenantA, currentPeriod);
      expect(budget.reservedMicroUsd).toBe(0);
      expect(budget.spentMicroUsd).toBe(1_800_000);
      expect(budget.availableMicroUsd).toBe(8_200_000);
    });

    it('debe liberar la reserva completamente sin sumar a spent si la llamada falla', async () => {
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'req-003',
        estimatedCostMicroUsd: 3_000_000,
        periodKey: currentPeriod,
      });

      const releaseRes = await service.release({
        tenantId: tenantA,
        correlationId: 'req-003',
        periodKey: currentPeriod,
      });

      expect(releaseRes.success).toBe(true);
      expect(releaseRes.releasedMicroUsd).toBe(3_000_000);
      expect(releaseRes.remainingMicroUsd).toBe(10_000_000);

      const budget = await service.getBudget(tenantA, currentPeriod);
      expect(budget.reservedMicroUsd).toBe(0);
      expect(budget.spentMicroUsd).toBe(0);
      expect(budget.availableMicroUsd).toBe(10_000_000);
    });
  });

  describe('Idempotencia de reserva y liberación', () => {
    it('debe responder idempotentemente si se intenta reservar dos veces con el mismo correlationId', async () => {
      const res1 = await service.reserve({
        tenantId: tenantA,
        correlationId: 'idem-1',
        estimatedCostMicroUsd: 1_000_000,
        periodKey: currentPeriod,
      });
      const res2 = await service.reserve({
        tenantId: tenantA,
        correlationId: 'idem-1',
        estimatedCostMicroUsd: 1_000_000,
        periodKey: currentPeriod,
      });

      expect(res1.granted).toBe(true);
      expect(res2.granted).toBe(true);
      expect(res2.correlationId).toBe('idem-1');

      // No debe haberse reservado el doble
      const budget = await service.getBudget(tenantA, currentPeriod);
      expect(budget.reservedMicroUsd).toBe(1_000_000);
    });

    it('liberar dos veces la misma reserva debe ser idempotente y seguro', async () => {
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'idem-rel',
        estimatedCostMicroUsd: 1_000_000,
        periodKey: currentPeriod,
      });

      const rel1 = await service.release({
        tenantId: tenantA,
        correlationId: 'idem-rel',
        periodKey: currentPeriod,
      });
      const rel2 = await service.release({
        tenantId: tenantA,
        correlationId: 'idem-rel',
        periodKey: currentPeriod,
      });

      expect(rel1.releasedMicroUsd).toBe(1_000_000);
      expect(rel2.releasedMicroUsd).toBe(0);
    });
  });

  describe('Límite duro y deduplicación de eventos (agent.budget.exhausted)', () => {
    it('debe rechazar reservas que superen el límite duro y emitir el evento UNA SOLA VEZ', async () => {
      // 1. Agotar casi todo el presupuesto: 9,500,000 de 10,000,000
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'fill-budget',
        estimatedCostMicroUsd: 9_500_000,
        periodKey: currentPeriod,
      });

      // 2. Intentar reservar 1,000,000 (excede los 500,000 restantes) -> debe ser rechazada
      const rejected1 = await service.reserve({
        tenantId: tenantA,
        correlationId: 'overflow-1',
        estimatedCostMicroUsd: 1_000_000,
        periodKey: currentPeriod,
      });

      expect(rejected1.granted).toBe(false);
      expect(rejected1.reason).toBe('BUDGET_EXHAUSTED');
      expect(rejected1.remainingMicroUsd).toBe(500_000);

      // Verificar que el evento se registró
      expect(fakeRepo.events.has(`${tenantA}:${currentPeriod}:agent.budget.exhausted`)).toBe(true);

      // 3. Segundo intento de exceder el presupuesto en el mismo mes -> rechazado pero NO duplica evento
      const recordEventSpy = vi.spyOn(fakeRepo, 'recordBudgetExhaustedEvent');
      const rejected2 = await service.reserve({
        tenantId: tenantA,
        correlationId: 'overflow-2',
        estimatedCostMicroUsd: 2_000_000,
        periodKey: currentPeriod,
      });

      expect(rejected2.granted).toBe(false);
      expect(rejected2.reason).toBe('BUDGET_EXHAUSTED');
      // Debe haber devuelto false en deduplicación
      const lastCallResult = await recordEventSpy.mock.results[0].value;
      expect(lastCallResult).toBe(false);
    });
  });

  describe('Concurrencia: 25 reservas simultáneas (Promise.all)', () => {
    it('debe procesar reservas concurrentes sin sobrepasar jamás el límite presupuestario', async () => {
      // Presupuesto total: 10,000,000 micro-USD
      // Lanzamos 25 peticiones simultáneas de 500,000 micro-USD cada una (Total solicitado: 12,500,000)
      // Exactamente 20 deben ser aprobadas (20 * 500,000 = 10,000,000) y 5 deben ser rechazadas por BUDGET_EXHAUSTED
      const concurrentRequests = Array.from({ length: 25 }, (_, i) => ({
        tenantId: tenantA,
        correlationId: `concurrent-${i}`,
        estimatedCostMicroUsd: 500_000,
        periodKey: currentPeriod,
      }));

      const results = await Promise.all(concurrentRequests.map((req) => service.reserve(req)));

      const approved = results.filter((r) => r.granted);
      const rejected = results.filter((r) => !r.granted);

      expect(approved.length).toBe(20);
      expect(rejected.length).toBe(5);
      rejected.forEach((r) => expect(r.reason).toBe('BUDGET_EXHAUSTED'));

      const finalBudget = await service.getBudget(tenantA, currentPeriod);
      expect(finalBudget.reservedMicroUsd).toBe(10_000_000);
      expect(finalBudget.availableMicroUsd).toBe(0);
      expect(finalBudget.isExhausted).toBe(true);
    });
  });

  describe('Aislamiento por Tenant', () => {
    it('el gasto del tenant A jamás afecta el disponible del tenant B', async () => {
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'a-1',
        estimatedCostMicroUsd: 10_000_000, // Agota tenant A
        periodKey: currentPeriod,
      });

      const budgetA = await service.getBudget(tenantA, currentPeriod);
      const budgetB = await service.getBudget(tenantB, currentPeriod);

      expect(budgetA.availableMicroUsd).toBe(0);
      expect(budgetA.isExhausted).toBe(true);

      // Tenant B debe estar intacto con sus 10,000,000 disponibles
      expect(budgetB.availableMicroUsd).toBe(10_000_000);
      expect(budgetB.isExhausted).toBe(false);
    });
  });

  describe('Rollover mensual de períodos', () => {
    it('un nuevo período mensual inicia con presupuesto limpio', async () => {
      // Agotar noviembre 2026
      await service.reserve({
        tenantId: tenantA,
        correlationId: 'nov-all',
        estimatedCostMicroUsd: 10_000_000,
        periodKey: '2026-11',
      });

      const novBudget = await service.getBudget(tenantA, '2026-11');
      expect(novBudget.isExhausted).toBe(true);

      // Diciembre 2026 debe tener disponible completo
      const decBudget = await service.getBudget(tenantA, '2026-12');
      expect(decBudget.isExhausted).toBe(false);
      expect(decBudget.availableMicroUsd).toBe(10_000_000);
      expect(decBudget.spentMicroUsd).toBe(0);
    });
  });

  describe('Modo degradado y plantillas estructuradas', () => {
    it('debe devolver la plantilla estructurada de degradación por BUDGET_EXHAUSTED', () => {
      const degraded = service.handleDegradedResponse(
        AgentDegradationReason.BUDGET_EXHAUSTED,
        tenantA,
      );

      expect(degraded.degraded).toBe(true);
      expect(degraded.reason).toBe(AgentDegradationReason.BUDGET_EXHAUSTED);
      expect(degraded.message).toContain('presupuesto mensual de tokens');
      expect(degraded.suggestions.length).toBeGreaterThan(0);
    });

    it('debe devolver la plantilla estructurada de degradación por PROVIDER_ERROR', () => {
      const degraded = service.handleDegradedResponse(
        AgentDegradationReason.PROVIDER_ERROR,
        tenantA,
      );

      expect(degraded.degraded).toBe(true);
      expect(degraded.reason).toBe(AgentDegradationReason.PROVIDER_ERROR);
      expect(degraded.message).toContain('proveedor de Inteligencia Artificial');
    });
  });

  describe('Idempotencia contable del repositorio (mocks)', () => {
    const buildBudget = (overrides: Partial<AgentTokenBudget> = {}): AgentTokenBudget => ({
      id: 'budget-mock',
      tenantId: tenantA,
      periodKey: currentPeriod,
      limitMicroUsd: 10_000_000,
      spentMicroUsd: 2_000_000,
      reservedMicroUsd: 0,
      warnRatio: 0.8,
      hardLimit: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    const buildReservation = (
      overrides: Partial<AgentTokenReservation> = {},
    ): AgentTokenReservation => ({
      id: 'res-mock',
      tenantId: tenantA,
      correlationId: 'mock-1',
      estimatedCostMicroUsd: 1_000_000,
      status: 'SETTLED',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    const buildService = (repository: IBudgetRepository): BudgetService => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'AGENT_TOKEN_BUDGET_USD_MONTHLY':
              return 10;
            case 'AGENT_BUDGET_WARN_RATIO':
              return 0.8;
            case 'AGENT_MODEL_INPUT_COST_PER_1K_USD':
              return 0.0015;
            case 'AGENT_MODEL_OUTPUT_COST_PER_1K_USD':
              return 0.002;
            case 'AGENT_DEGRADED_MODE_ENABLED':
              return 'true';
            default:
              return defaultValue;
          }
        }),
      } as unknown as ConfigService;

      return new BudgetService(repository, mockConfig);
    };

    it('settle con alreadySettled=true no duplica uso, no suma gasto y no re-emite warning', async () => {
      const usage: AgentTokenUsage = {
        id: 'usage-existing',
        tenantId: tenantA,
        correlationId: 'mock-1',
        conversationId: null,
        model: 'mock-model',
        promptTokens: 800,
        completionTokens: 300,
        costMicroUsd: 1_800_000,
        cacheHit: false,
        degraded: false,
        createdAt: new Date(),
      };
      const repository = {
        settleReservation: vi.fn().mockResolvedValue({
          alreadySettled: true,
          budget: buildBudget({ spentMicroUsd: 2_000_000, reservedMicroUsd: 0 }),
          reservation: buildReservation(),
          usage,
        }),
      } as unknown as IBudgetRepository;

      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const mockedService = buildService(repository);

      const result = await mockedService.settle({
        tenantId: tenantA,
        correlationId: 'mock-1',
        // Valores distintos a los persistidos: deben ignorarse en el reintento idempotente.
        actualCostMicroUsd: 9_000_000,
        promptTokens: 1,
        completionTokens: 1,
        periodKey: currentPeriod,
      });

      expect(result.success).toBe(true);
      expect(result.settled).toBe(true);
      expect(result.actualCostMicroUsd).toBe(1_800_000);
      expect(result.consumption.totalTokens).toBe(1100);
      // El snapshot no se altera: 10M - (2M gastado + 0 reservado)
      expect(result.remainingMicroUsd).toBe(8_000_000);
      expect(repository.settleReservation).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('reserve con una reserva ACTIVE existente no incrementa el saldo reservado', async () => {
      const reservation = buildReservation({ estimatedCostMicroUsd: 1_000_000 });
      const repository = {
        reserveAtomic: vi.fn().mockResolvedValue({
          granted: true,
          budget: buildBudget({ spentMicroUsd: 0, reservedMicroUsd: 1_000_000 }),
          reservation,
        }),
      } as unknown as IBudgetRepository;

      const mockedService = buildService(repository);

      const result = await mockedService.reserve({
        tenantId: tenantA,
        correlationId: 'mock-1',
        estimatedCostMicroUsd: 1_000_000,
        periodKey: currentPeriod,
      });

      expect(result.granted).toBe(true);
      expect(result.reservedMicroUsd).toBe(1_000_000);
      // 10M - (0 gastado + 1M reservado), sin doble reserva
      expect(result.remainingMicroUsd).toBe(9_000_000);
      expect(repository.reserveAtomic).toHaveBeenCalledTimes(1);
    });

    // E2E pendiente (siguiente iteración): levantar Postgres real y reutilizar el patrón de
    // `test/agent.repository.e2e-spec.ts` para lanzar dos settleReservation concurrentes sobre
    // el mismo correlationId y verificar que solo se inserta una fila en agent_token_usage.
  });
});
