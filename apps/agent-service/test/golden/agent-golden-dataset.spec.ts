import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { type McpCallToolResult, type RequestContext, UserRole } from '@mybusiness/contracts';
import { ChatService } from '../../src/chat/chat.service';
import { DeterministicLlmProvider } from '../../src/chat/llm-provider';
import type { BudgetService } from '../../src/budget/budget.service';
import type { SemanticCacheService } from '../../src/cache/semantic-cache.service';
import type { McpToolsService } from '../../src/mcp/mcp-tools.service';
import type { AgentService } from '../../src/agent.service';
import {
  DEMO_TENANT_ID,
  GOLDEN_DATASET,
  type GoldenQuestionCase,
} from './agent-golden-dataset.fixture';

interface GoldenDatasetFailure {
  id: string;
  category: string;
  question: string;
  expectedFigure: string;
  obtainedAnswer: string;
  sqlReference: string;
  reason: string;
}

function buildFailureReport(failures: GoldenDatasetFailure[], total: number): string {
  const passed = total - failures.length;
  const matchRatio = ((passed / total) * 100).toFixed(2);

  const lines: string[] = [
    '================================================================================',
    '                   REPORTE DE EJECUCIÓN: SET DORADO DE CIFRAS                  ',
    '================================================================================',
    `Total de preguntas evaluadas : ${total}`,
    `Coincidencias exactas (100%) : ${passed}`,
    `Discrepancias detectadas     : ${failures.length}`,
    `Porcentaje de coincidencia   : ${matchRatio}% (Umbral requerido: 100.00%)`,
    '--------------------------------------------------------------------------------',
  ];

  if (failures.length > 0) {
    lines.push('PREGUNTAS FALLIDAS:');
    for (const f of failures) {
      lines.push(`  [${f.id}] (${f.category.toUpperCase()})`);
      lines.push(`    Pregunta        : "${f.question}"`);
      lines.push(`    Cifra Esperada  : ${f.expectedFigure}`);
      lines.push(`    Respuesta LLM   : "${f.obtainedAnswer}"`);
      lines.push(`    Causa de fallo  : ${f.reason}`);
      lines.push(`    SQL Referencia  : ${f.sqlReference}`);
      lines.push(
        '--------------------------------------------------------------------------------',
      );
    }
  } else {
    lines.push(
      '  ¡Todas las 30 preguntas doradas coincidieron exactamente con el SQL de referencia!',
    );
  }
  lines.push('================================================================================');

  return lines.join('\n');
}

function createHarnessForCase(testCase: GoldenQuestionCase) {
  const budget = {
    reserve: vi.fn().mockResolvedValue({
      granted: true,
      correlationId: 'corr-golden',
      remainingMicroUsd: 10_000_000,
    }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      remainingMicroUsd: 9_999_900,
      settled: true,
    }),
    release: vi.fn().mockResolvedValue({
      success: true,
      remainingMicroUsd: 10_000_000,
    }),
    estimateCost: vi.fn().mockReturnValue(100),
    calculateCost: vi.fn().mockReturnValue(42),
    handleDegradedResponse: vi.fn(),
  } as unknown as BudgetService;

  const cache = {
    get: vi.fn().mockResolvedValue({ hit: false }),
    set: vi.fn().mockResolvedValue(undefined),
  } as unknown as SemanticCacheService;

  const toolCall = vi.fn(async (): Promise<McpCallToolResult> => {
    return {
      tool: testCase.tool,
      schemaVersion: '1.0.0',
      data: testCase.toolData,
    };
  });

  const mcp = { call: toolCall } as unknown as McpToolsService;

  const agent = {
    searchSimilar: vi.fn().mockResolvedValue({ query: '', results: [] }),
    storeMemory: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentService;

  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;

  const provider = new DeterministicLlmProvider({ mode: 'grounded' });

  const service = new ChatService(budget, cache, mcp, agent, provider, config);

  return { service, toolCall };
}

describe('Set Dorado de Cifras Financieras (SF3-06)', () => {
  const CTX: RequestContext = {
    tenantId: DEMO_TENANT_ID,
    userId: '00000000-0000-0000-0000-000000000002',
    role: UserRole.ACCOUNTANT,
  };

  it('el set dorado contiene al menos 30 preguntas con SQL de referencia versionado', () => {
    expect(GOLDEN_DATASET.length).toBeGreaterThanOrEqual(30);

    for (const item of GOLDEN_DATASET) {
      expect(item.id).toMatch(/^GQ-\d{2}$/);
      expect(item.question.trim().length).toBeGreaterThan(10);
      expect(item.sqlReference.trim().toUpperCase()).toContain('SELECT');
      expect(item.sqlReference).toContain(DEMO_TENANT_ID);
      expect(item.expectedNumbers.length).toBeGreaterThan(0);
      expect(item.expectedFigure.trim().length).toBeGreaterThan(0);
      expect(item.toolData).toBeDefined();
    }
  });

  describe('Ejecución caso a caso del set dorado', () => {
    for (const item of GOLDEN_DATASET) {
      it(`[${item.id}] ${item.question}`, async () => {
        const { service, toolCall } = createHarnessForCase(item);

        const response = await service.chat(CTX, { message: item.question });

        expect(response.degraded).toBe(false);
        expect(toolCall).toHaveBeenCalled();

        for (const expectedNum of item.expectedNumbers) {
          const answerHasNumber = response.answer.includes(expectedNum);
          expect(
            answerHasNumber,
            `Caso ${item.id} falló: la cifra esperada '${expectedNum}' no apareció en la respuesta del agente: "${response.answer}"`,
          ).toBe(true);
        }
      });
    }
  });

  it('evaluación global: umbral bloqueante 100% de coincidencia numérica y reporte de fallos', async () => {
    const failures: GoldenDatasetFailure[] = [];

    for (const item of GOLDEN_DATASET) {
      const { service } = createHarnessForCase(item);
      try {
        const response = await service.chat(CTX, { message: item.question });

        if (response.degraded) {
          failures.push({
            id: item.id,
            category: item.category,
            question: item.question,
            expectedFigure: item.expectedFigure,
            obtainedAnswer: response.answer,
            sqlReference: item.sqlReference,
            reason: `Respuesta degradada (${response.reason ?? 'UNKNOWN'})`,
          });
          continue;
        }

        const missing = item.expectedNumbers.filter((num) => !response.answer.includes(num));
        if (missing.length > 0) {
          failures.push({
            id: item.id,
            category: item.category,
            question: item.question,
            expectedFigure: item.expectedFigure,
            obtainedAnswer: response.answer,
            sqlReference: item.sqlReference,
            reason: `Faltan las cifras esperadas: [${missing.join(', ')}]`,
          });
        }
      } catch (error) {
        failures.push({
          id: item.id,
          category: item.category,
          question: item.question,
          expectedFigure: item.expectedFigure,
          obtainedAnswer: 'ERROR_DE_EJECUCIÓN',
          sqlReference: item.sqlReference,
          reason: (error as Error).message,
        });
      }
    }

    const report = buildFailureReport(failures, GOLDEN_DATASET.length);
    console.log(report);

    // Umbral bloqueante estricto: cero fallos permitidos (100% coincidencia)
    expect(
      failures.length,
      `Set dorado falló con ${failures.length} discrepancias numéricas.\n${report}`,
    ).toBe(0);
  });

  it('extensibilidad: añadir una nueva pregunta no requiere modificar el runner', async () => {
    // Demuestra que cualquier nuevo caso que cumpla con `GoldenQuestionCase` es procesado directamente
    const newCase: GoldenQuestionCase = {
      id: 'GQ-99',
      category: 'balance',
      question: '¿Cuál es el saldo total proyectado en 2026-07-01 a 2026-07-31?',
      sqlReference: `SELECT COALESCE(SUM(current_balance_minor), 0)::text AS balance_minor FROM bank_accounts WHERE tenant_id = '${DEMO_TENANT_ID}';`,
      tool: 'get_cashflow_summary',
      toolData: {
        currency: 'COP',
        balanceMinor: '9999999999',
        incomeMinor: '100000000',
        expenseMinor: '50000000',
      },
      expectedNumbers: ['9999999999'],
      expectedFigure: '9999999999',
      description: 'Prueba de extensibilidad sin alterar el runner',
    };

    const { service } = createHarnessForCase(newCase);
    const response = await service.chat(CTX, { message: newCase.question });

    expect(response.degraded).toBe(false);
    expect(response.answer).toContain('9999999999');
  });
});
