import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import { AgentDatabaseService } from '../src/database/database.service';
import {
  agentBudgetEvents,
  agentTokenBudgets,
  agentTokenReservations,
  agentTokenUsage,
} from '../src/database/schema';
import { BudgetRepository } from '../src/budget/budget.repository';
import { BudgetService } from '../src/budget/budget.service';
import { getUtcPeriodKey } from '../src/budget/budget.constants';

/**
 * Suite e2e de gobernanza de tokens (SF3-03) contra PostgreSQL real.
 * Requiere `AGENT_DATABASE_URL`; en su ausencia la suite se omite.
 */
const databaseUrl = process.env.AGENT_DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

/** ConfigService falso: devuelve los valores indicados y el fallback del servicio. */
function createConfig(values: Record<string, string | number>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

describeIf('BudgetService — e2e con PostgreSQL (reserva, liquidación y concurrencia)', () => {
  let database: AgentDatabaseService;
  let repository: BudgetRepository;
  let service: BudgetService;
  let createdTenants: string[] = [];
  const periodKey = getUtcPeriodKey();

  /** Crea un tenant efímero y lo registra para la limpieza posterior. */
  function newTenant(): string {
    const tenantId = randomUUID();
    createdTenants.push(tenantId);
    return tenantId;
  }

  /**
   * Siembra el presupuesto del período con un límite explícito en micro-USD.
   * Se usa el repositorio real para no depender de límites mínimos de configuración.
   */
  async function seedBudget(tenantId: string, limitMicroUsd: number): Promise<void> {
    await repository.getOrCreateBudget(tenantId, periodKey, limitMicroUsd, 0.8, true);
  }

  async function cleanup(tenantIds: string[]): Promise<void> {
    if (!database || tenantIds.length === 0) {
      return;
    }
    await database.db.delete(agentTokenUsage).where(inArray(agentTokenUsage.tenantId, tenantIds));
    await database.db
      .delete(agentTokenReservations)
      .where(inArray(agentTokenReservations.tenantId, tenantIds));
    await database.db
      .delete(agentTokenBudgets)
      .where(inArray(agentTokenBudgets.tenantId, tenantIds));
    await database.db
      .delete(agentBudgetEvents)
      .where(inArray(agentBudgetEvents.tenantId, tenantIds));
  }

  beforeAll(() => {
    database = new AgentDatabaseService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);
    repository = new BudgetRepository(database);
    service = new BudgetService(
      repository,
      createConfig({
        AGENT_TOKEN_BUDGET_USD_MONTHLY: 50,
        AGENT_BUDGET_WARN_RATIO: 0.8,
        AGENT_MODEL_INPUT_COST_PER_1K_USD: 0.0015,
        AGENT_MODEL_OUTPUT_COST_PER_1K_USD: 0.002,
      }),
    );
  });

  afterEach(async () => {
    const tenants = createdTenants;
    createdTenants = [];
    await cleanup(tenants);
  });

  afterAll(async () => {
    if (!database) {
      return;
    }
    await cleanup(createdTenants);
    await database.onModuleDestroy();
  });

  it('a) reserva concurrente con el mismo correlationId: una sola reserva y un solo cargo', async () => {
    const tenantId = newTenant();
    await seedBudget(tenantId, 10_000_000);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.reserve({ tenantId, correlationId: 'c1', estimatedCostMicroUsd: 1000 }),
      ),
    );

    // Contrato de reintento idempotente: todas las llamadas se resuelven sobre la MISMA
    // reserva (granted:true) y la comprobación monetaria es la que garantiza el no doble cargo.
    const grants = results.filter((result) => result.granted);
    expect(grants).toHaveLength(5);
    expect(grants.every((result) => result.correlationId === 'c1')).toBe(true);

    const budget = await service.getBudget(tenantId, periodKey);
    expect(budget.reservedMicroUsd).toBe(1000);
    expect(budget.spentMicroUsd).toBe(0);

    const reservations = await database.db
      .select()
      .from(agentTokenReservations)
      .where(eq(agentTokenReservations.tenantId, tenantId));

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('ACTIVE');
    expect(reservations[0].estimatedCostMicroUsd).toBe(1000);
  });

  it('b) doble settle: el reintento es idempotente y solo imputa el consumo una vez', async () => {
    const tenantId = newTenant();
    await seedBudget(tenantId, 10_000_000);

    await service.reserve({ tenantId, correlationId: 'c1', estimatedCostMicroUsd: 1000 });

    const first = await service.settle({
      tenantId,
      correlationId: 'c1',
      actualCostMicroUsd: 1500,
      promptTokens: 100,
      completionTokens: 50,
    });
    const second = await service.settle({
      tenantId,
      correlationId: 'c1',
      actualCostMicroUsd: 1500,
      promptTokens: 100,
      completionTokens: 50,
    });

    expect(first.alreadySettled).toBe(false);
    expect(second.alreadySettled).toBe(true);

    const budget = await service.getBudget(tenantId, periodKey);
    expect(budget.spentMicroUsd).toBe(1500);
    expect(budget.reservedMicroUsd).toBe(0);

    const usages = await database.db
      .select()
      .from(agentTokenUsage)
      .where(eq(agentTokenUsage.tenantId, tenantId));

    expect(usages).toHaveLength(1);
    expect(usages[0].costMicroUsd).toBe(1500);
  });

  it('c) settle tras release: lanza error y no altera el presupuesto', async () => {
    const tenantId = newTenant();
    await seedBudget(tenantId, 10_000_000);

    await service.reserve({ tenantId, correlationId: 'c1', estimatedCostMicroUsd: 1000 });
    const released = await service.release({ tenantId, correlationId: 'c1' });
    expect(released.releasedMicroUsd).toBe(1000);

    await expect(
      service.settle({
        tenantId,
        correlationId: 'c1',
        actualCostMicroUsd: 1500,
        promptTokens: 100,
        completionTokens: 50,
      }),
    ).rejects.toThrow(/RELEASED/);

    const budget = await service.getBudget(tenantId, periodKey);
    expect(budget.spentMicroUsd).toBe(0);
    expect(budget.reservedMicroUsd).toBe(0);

    const usages = await database.db
      .select()
      .from(agentTokenUsage)
      .where(eq(agentTokenUsage.tenantId, tenantId));
    expect(usages).toHaveLength(0);
  });

  it('d) presupuesto agotado: rechaza la reserva, la marca REJECTED y no retiene saldo', async () => {
    const tenantId = newTenant();
    await seedBudget(tenantId, 1000);

    const result = await service.reserve({
      tenantId,
      correlationId: 'c1',
      estimatedCostMicroUsd: 2000,
    });

    expect(result.granted).toBe(false);
    expect(result.reason).toBe('BUDGET_EXHAUSTED');
    expect(result.reservedMicroUsd).toBe(0);

    const reservation = await repository.findReservation(tenantId, 'c1');
    expect(reservation?.status).toBe('REJECTED');

    const budget = await service.getBudget(tenantId, periodKey);
    expect(budget.reservedMicroUsd).toBe(0);
    expect(budget.spentMicroUsd).toBe(0);
  });

  it('e) release idempotente: la segunda liberación no devuelve saldo ni deja residuo', async () => {
    const tenantId = newTenant();
    await seedBudget(tenantId, 10_000_000);

    await service.reserve({ tenantId, correlationId: 'c1', estimatedCostMicroUsd: 1000 });

    const first = await service.release({ tenantId, correlationId: 'c1' });
    const second = await service.release({ tenantId, correlationId: 'c1' });

    expect(first.releasedMicroUsd).toBe(1000);
    expect(second.releasedMicroUsd).toBe(0);

    const budget = await service.getBudget(tenantId, periodKey);
    expect(budget.reservedMicroUsd).toBe(0);
    expect(budget.availableMicroUsd).toBe(10_000_000);
  });

  it('f) aislamiento multi-tenant: cada reserva consume únicamente su propio presupuesto', async () => {
    const tenantA = newTenant();
    const tenantB = newTenant();
    await seedBudget(tenantA, 10_000_000);
    await seedBudget(tenantB, 10_000_000);

    await service.reserve({ tenantId: tenantA, correlationId: 'c1', estimatedCostMicroUsd: 3000 });
    await service.reserve({ tenantId: tenantB, correlationId: 'c1', estimatedCostMicroUsd: 7000 });

    const [budgetA, budgetB] = await Promise.all([
      service.getBudget(tenantA, periodKey),
      service.getBudget(tenantB, periodKey),
    ]);

    expect(budgetA.reservedMicroUsd).toBe(3000);
    expect(budgetB.reservedMicroUsd).toBe(7000);
    expect(budgetA.availableMicroUsd).toBe(9_997_000);
    expect(budgetB.availableMicroUsd).toBe(9_993_000);
  });
});
