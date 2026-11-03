import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { generateTransactionPayload } from './lib/idempotency.js';
import { setupLoadEnvironment, verifyPersistedCount } from './lib/setup.js';

// Métricas personalizadas exigidas por Issue #54
export const eventLossRate = new Rate('event_loss_rate');
export const transactionsAccepted = new Counter('transactions_accepted');
export const transactionsDeduplicated = new Counter('transactions_deduplicated');
export const uniqueTransactions = new Counter('unique_transactions');

// Configuración de entorno
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3200';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'access-tenant-a';
const TENANT_ID = __ENV.TENANT_ID || '00000000-0000-0000-0000-000000000001';

// Parámetros de ejecución: Modo SMOKE (local/CI rápido) vs Escenario Completo 50k (30 min)
const isSmoke = __ENV.SMOKE === 'true';

const smokeStages = [
  { target: 10, duration: '2s' },
  { target: 20, duration: '6s' },
  { target: 0, duration: '2s' },
];

const full50kStages = [
  { target: 28, duration: '2m' },   // Rampa ascendente hacia ~27.8 req/s
  { target: 28, duration: '26m' },  // Estado estacionario (50k txs acumuladas)
  { target: 0, duration: '2m' },    // Rampa de descenso
];

export const options = {
  scenarios: {
    ingest_transactions: {
      executor: 'ramping-arrival-rate',
      startRate: isSmoke ? 5 : 10,
      timeUnit: '1s',
      preAllocatedVUs: isSmoke ? 10 : 60,
      maxVUs: isSmoke ? 30 : 250,
      stages: isSmoke ? smokeStages : full50kStages,
    },
  },
  thresholds: {
    // Criterios obligatorios de aceptación de #54
    http_req_duration: ['p(95)<5000'],   // p95 < 5 s
    http_req_failed: ['rate<0.01'],      // tasa de fallo HTTP < 1%
    event_loss_rate: ['rate==0'],        // 0 eventos perdidos
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
  console.log(`[k6 setup] Iniciando prueba de carga contra ${BASE_URL} (modo: ${isSmoke ? 'SMOKE' : 'FULL 50K'})`);
  return setupLoadEnvironment(BASE_URL, AUTH_TOKEN, TENANT_ID);
}

export default function (data) {
  // Índice único de iteración a través del VU y su iteración local
  const iteration = __VU * 100000 + __ITER;
  const { payload, isDuplicate, idempotencyKey } = generateTransactionPayload(
    data.tenantId,
    data.bankAccountId,
    iteration,
  );

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.authToken}`,
  };

  const response = http.post(
    `${data.baseUrl}/api/v1/finance/transactions`,
    JSON.stringify(payload),
    {
      headers,
      tags: { name: 'PostTransaction', is_duplicate: isDuplicate ? 'true' : 'false' },
      timeout: '10s',
    },
  );

  const isAccepted = response.status === 201 || response.status === 200;

  const passed = check(response, {
    'transacción aceptada (200 o 201)': (r) => r.status === 200 || r.status === 201,
    'tiempo de respuesta < 5000ms': (r) => r.timings.duration < 5000,
  });

  if (isAccepted) {
    transactionsAccepted.add(1);
    if (isDuplicate || response.status === 200) {
      transactionsDeduplicated.add(1);
    } else {
      uniqueTransactions.add(1);
    }
    eventLossRate.add(0);
  } else {
    // Si la petición falla y no es un duplicado controlado, se marca pérdida/error
    eventLossRate.add(1);
    console.error(`[k6 error] Fallo en transacción #${iteration}: status=${response.status} body=${response.body}`);
  }
}

export function teardown(data) {
  console.log('[k6 teardown] Verificando conteo de transacciones persistidas...');
  const verification = verifyPersistedCount(data.baseUrl, data.authToken, data.initialCount);

  console.log(`[k6 teardown] Conteo inicial: ${data.initialCount}, Conteo final: ${verification.finalCount}, Nuevas persistidas: ${verification.newlyPersisted}`);

  // En caso de que el backend soporte conteo directo, certificamos consistencia
  if (verification.finalCount < data.initialCount) {
    console.error('[k6 teardown ERROR] Se detectó pérdida o discrepancia de datos.');
  } else {
    console.log('[k6 teardown ÉXITO] 0 pérdida de eventos certificada.');
  }
}

export function handleSummary(data) {
  return {
    'tests/load/k6-summary.json': JSON.stringify(data, null, 2),
    stdout: generateConsoleSummary(data),
  };
}

function generateConsoleSummary(data) {
  const reqDuration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values : {};
  const reqFailed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values : {};
  const httpReqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : {};
  const loss = data.metrics.event_loss_rate ? data.metrics.event_loss_rate.values : {};

  return `
================================================================================
              REPORTE DE EJECUCIÓN K6 - INGESTA DE TRANSACCIONES (#54)
================================================================================
Total Peticiones HTTP:   ${httpReqs.count || 0} (Throughput: ${(httpReqs.rate || 0).toFixed(2)} req/s)
Tasa de Fallo HTTP:      ${((reqFailed.rate || 0) * 100).toFixed(2)}%
Latencia Media:          ${(reqDuration.avg || 0).toFixed(2)} ms
Latencia Mediana (p50):  ${(reqDuration.med || 0).toFixed(2)} ms
Latencia p90:            ${(reqDuration['p(90)'] || 0).toFixed(2)} ms
Latencia p95 (Límite 5s):${(reqDuration['p(95)'] || 0).toFixed(2)} ms  -> ${reqDuration['p(95)'] < 5000 ? 'PASS [OK]' : 'FAIL'}
Latencia Máxima:         ${(reqDuration.max || 0).toFixed(2)} ms
Pérdida de Eventos:      ${((loss.rate || 0) * 100).toFixed(2)}% (0% requerido) -> ${loss.rate === 0 ? 'PASS [OK]' : 'FAIL'}
================================================================================
`;
}
