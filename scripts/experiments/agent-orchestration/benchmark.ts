/**
 * Benchmark determinista de orquestación de agentes (SF3-01).
 * Ejecuta 35 repeticiones por cada uno de los 3 escenarios y calcula:
 * - Latencias p50, p90, p95, avg, min, max
 * - Consumo de tokens (prompt / completion) y coste estimado USD
 * - Tasa de éxito, degradación y observabilidad (spans)
 */

import { FakeLLMProvider } from './fake-llm-provider.ts';
import { CustomAgentOrchestrator } from './orchestrator.ts';
import { allTools } from './tools.ts';
import type { OrchestrationResult, ScenarioMetricSummary, ToolContext } from './types.ts';

const REPETITIONS = 35; // Cumple el requisito de mínimo 30 iteraciones

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runScenario(
  scenarioName: string,
  userPrompt: string,
  provider: FakeLLMProvider,
  ctx: ToolContext,
): Promise<ScenarioMetricSummary> {
  const orchestrator = new CustomAgentOrchestrator({
    provider,
    tools: allTools,
  });

  const latencies: number[] = [];
  const promptTokensList: number[] = [];
  const completionTokensList: number[] = [];
  const costs: number[] = [];

  let successRuns = 0;
  let degradedRuns = 0;
  let failedRuns = 0;
  let totalToolCalls = 0;

  for (let i = 0; i < REPETITIONS; i++) {
    const result: OrchestrationResult = await orchestrator.handleTurn(userPrompt, ctx);

    latencies.push(result.totalDurationMs);
    promptTokensList.push(result.totalTokens.promptTokens);
    completionTokensList.push(result.totalTokens.completionTokens);
    costs.push(result.estimatedCostUSD);
    totalToolCalls += result.toolCallsCount;

    if (result.error?.degraded) {
      degradedRuns++;
    } else if (result.error) {
      failedRuns++;
    } else {
      successRuns++;
    }
  }

  latencies.sort((a, b) => a - b);

  const sumLatency = latencies.reduce((acc, val) => acc + val, 0);
  const avgMs = Number((sumLatency / latencies.length).toFixed(2));
  const p50Ms = calculatePercentile(latencies, 50);
  const p90Ms = calculatePercentile(latencies, 90);
  const p95Ms = calculatePercentile(latencies, 95);
  const minMs = latencies[0];
  const maxMs = latencies[latencies.length - 1];

  const avgPromptTokens = Math.round(
    promptTokensList.reduce((acc, val) => acc + val, 0) / REPETITIONS,
  );
  const avgCompletionTokens = Math.round(
    completionTokensList.reduce((acc, val) => acc + val, 0) / REPETITIONS,
  );
  const avgCostUSD = Number((costs.reduce((acc, val) => acc + val, 0) / REPETITIONS).toFixed(7));
  const toolCallsPerTurn = Number((totalToolCalls / REPETITIONS).toFixed(1));

  return {
    scenarioName,
    totalRuns: REPETITIONS,
    successRuns,
    degradedRuns,
    failedRuns,
    p50Ms,
    p90Ms,
    p95Ms,
    avgMs,
    minMs,
    maxMs,
    avgPromptTokens,
    avgCompletionTokens,
    avgCostUSD,
    toolCallsPerTurn,
  };
}

async function main() {
  console.log('='.repeat(75));
  console.log('  MYBUSINESS — BENCHMARK DE ORQUESTACIÓN DE AGENTES (SF3-01 / #71)');
  console.log(`  Entorno: Node ${process.version} | ${REPETITIONS} iteraciones por escenario`);
  console.log('='.repeat(75));

  const context: ToolContext = {
    tenantId: '11111111-2222-3333-4444-555555555555',
    userId: 'user-cfo-001',
    conversationId: 'conv-bench-001',
    traceId: 'trace-sf3-01-bench',
  };

  // 1. Escenario A: Consulta de saldo simple (Single tool)
  console.log('\n[1/3] Ejecutando Escenario A: Consulta de saldo simple (1 herramienta)...');
  const providerA = new FakeLLMProvider({ simulatedNetworkDelayMs: 6 });
  const summaryA = await runScenario(
    'Escenario A: Saldo Simple (get_account_balance)',
    '¿Cuál es el saldo disponible de mi cuenta operativa?',
    providerA,
    context,
  );

  // 2. Escenario B: Consulta multi-herramienta (Multi-tool)
  console.log(
    '[2/3] Ejecutando Escenario B: Consulta multi-herramienta (Cashflow + Transacciones)...',
  );
  const providerB = new FakeLLMProvider({ simulatedNetworkDelayMs: 8 });
  const summaryB = await runScenario(
    'Escenario B: Multi-Herramienta (Cashflow + Unreconciled)',
    'Resume mi flujo de caja de este mes y dime qué facturas o movimientos están pendientes de conciliar.',
    providerB,
    context,
  );

  // 3. Escenario C: Fallo del proveedor (Provider failure con degradación)
  console.log(
    '[3/3] Ejecutando Escenario C: Fallo del proveedor del modelo (Inyección de error 503 / Timeout)...',
  );
  const providerC = new FakeLLMProvider({
    failureMode: 'http_503',
    simulatedNetworkDelayMs: 4,
  });
  const summaryC = await runScenario(
    'Escenario C: Fallo de Proveedor (HTTP 503 / Degradación)',
    '¿Cuál es el saldo actual?',
    providerC,
    context,
  );

  const summaries = [summaryA, summaryB, summaryC];

  console.log('\n' + '='.repeat(75));
  console.log('  TABLA DE RESULTADOS CONSOLIDADOS');
  console.log('='.repeat(75));
  console.table(
    summaries.map((s) => ({
      Escenario: s.scenarioName,
      'Runs (Ok/Deg/Fail)': `${s.successRuns}/${s.degradedRuns}/${s.failedRuns}`,
      'p50 (ms)': s.p50Ms,
      'p95 (ms)': s.p95Ms,
      'Avg (ms)': s.avgMs,
      'Tools/Turno': s.toolCallsPerTurn,
      'Prompt Tokens': s.avgPromptTokens,
      'Compl. Tokens': s.avgCompletionTokens,
      'Coste (USD)': `$${s.avgCostUSD.toFixed(6)}`,
    })),
  );

  console.log('\nDetalle de Métricas en formato JSON estructurado:');
  console.log(JSON.stringify(summaries, null, 2));

  console.log('\n✅ Benchmark completado con éxito. 0 errores fatales no controlados.');
}

main().catch((err) => {
  console.error('Error fatal durante el benchmark:', err);
  process.exit(1);
});
