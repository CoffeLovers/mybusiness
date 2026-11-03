import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetController } from '../src/budget/budget.controller';
import type { BudgetService } from '../src/budget/budget.service';

describe('BudgetController (SF3-03 MessagePatterns)', () => {
  let controller: BudgetController;
  let mockBudgetService: Partial<BudgetService>;

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = 'user-001';

  beforeEach(() => {
    mockBudgetService = {
      getBudget: vi.fn().mockResolvedValue({
        tenantId,
        periodKey: '2026-11',
        limitMicroUsd: 50_000_000,
        spentMicroUsd: 10_000_000,
        reservedMicroUsd: 2_000_000,
        availableMicroUsd: 38_000_000,
        warnRatio: 0.8,
        hardLimit: true,
        isExhausted: false,
        isWarning: false,
      }),
      getUsage: vi.fn().mockResolvedValue({
        tenantId,
        periodKey: '2026-11',
        totalRequests: 5,
        promptTokens: 2500,
        completionTokens: 1000,
        totalTokens: 3500,
        totalCostMicroUsd: 5750,
        cacheHits: 1,
        cacheHitRate: 0.2,
        degradedRequests: 0,
      }),
      reserve: vi.fn().mockResolvedValue({
        granted: true,
        correlationId: 'corr-1',
        reservedMicroUsd: 2500,
        remainingMicroUsd: 37_997_500,
      }),
      settle: vi.fn().mockResolvedValue({
        success: true,
        correlationId: 'corr-1',
        actualCostMicroUsd: 2200,
        remainingMicroUsd: 37_997_800,
        consumption: {
          promptTokens: 800,
          completionTokens: 500,
          totalTokens: 1300,
          costMicroUsd: 2200,
          cacheHit: false,
          degraded: false,
          remainingMicroUsd: 37_997_800,
        },
      }),
      release: vi.fn().mockResolvedValue({
        success: true,
        correlationId: 'corr-1',
        releasedMicroUsd: 2500,
        remainingMicroUsd: 38_000_000,
      }),
    };

    controller = new BudgetController(mockBudgetService as BudgetService);
  });

  it('debe extraer el contexto RPC y llamar a getBudget', async () => {
    const payload = {
      tenantId,
      userId,
      periodKey: '2026-11',
    };

    const res = await controller.getBudget(payload as any);

    expect(mockBudgetService.getBudget).toHaveBeenCalledWith(tenantId, '2026-11');
    expect(res).toBeDefined();
    expect(res.availableMicroUsd).toBe(38_000_000);
  });

  it('debe extraer el contexto RPC y llamar a getUsage', async () => {
    const payload = {
      tenantId,
      userId,
      periodKey: '2026-11',
    };

    const res = await controller.getUsage(payload as any);

    expect(mockBudgetService.getUsage).toHaveBeenCalledWith(tenantId, '2026-11');
    expect(res.totalRequests).toBe(5);
  });

  it('debe extraer el contexto RPC y delegar en reserve', async () => {
    const payload = {
      tenantId,
      userId,
      correlationId: 'corr-1',
      estimatedCostMicroUsd: 2500,
    };

    const res = await controller.reserveBudget(payload as any);

    expect(mockBudgetService.reserve).toHaveBeenCalledWith({
      tenantId,
      correlationId: 'corr-1',
      estimatedCostMicroUsd: 2500,
    });
    expect(res.granted).toBe(true);
  });

  it('debe extraer el contexto RPC y delegar en settle', async () => {
    const payload = {
      tenantId,
      userId,
      correlationId: 'corr-1',
      actualCostMicroUsd: 2200,
      promptTokens: 800,
      completionTokens: 500,
      model: 'gpt-4o-mini',
      cacheHit: false,
      degraded: false,
    };

    const res = await controller.settleBudget(payload as any);

    expect(mockBudgetService.settle).toHaveBeenCalledWith({
      tenantId,
      correlationId: 'corr-1',
      actualCostMicroUsd: 2200,
      promptTokens: 800,
      completionTokens: 500,
      model: 'gpt-4o-mini',
      conversationId: undefined,
      cacheHit: false,
      degraded: false,
    });
    expect(res.success).toBe(true);
  });

  it('debe extraer el contexto RPC y delegar en release', async () => {
    const payload = {
      tenantId,
      userId,
      correlationId: 'corr-1',
    };

    const res = await controller.releaseBudget(payload as any);

    expect(mockBudgetService.release).toHaveBeenCalledWith({
      tenantId,
      correlationId: 'corr-1',
    });
    expect(res.releasedMicroUsd).toBe(2500);
  });
});
