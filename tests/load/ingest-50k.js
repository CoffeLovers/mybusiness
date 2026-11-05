import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { generateTransactionPayload } from './lib/idempotency.js';
import { setupLoadEnvironment } from './lib/setup.js';

// Métricas personalizadas exigidas por Issue #54
export const transactionsAccepted = new Counter('transactions_accepted');
export const uniqueTransactions = new Counter('unique_transactions');
export const http429 = new Counter('http_429');

// Parámetros de ejecución: Modo SMOKE (validación rápida del arnés) vs Escenario Completo 50k (30 min)
const isSmoke = __ENV.SMOKE === 'true';

const smokeScenario = {
  executor: 'constant-arrival-rate',
  rate: 10,
  timeUnit: '1s',
  duration: '10s',
  preAllocatedVUs: 10,
  maxVUs: 30,
};

const full50kScenario = {
  executor: 'constant-arrival-rate',
  rate: 30,
  timeUnit: '1s',
  duration: '30m',
  preAllocatedVUs: 200,
  maxVUs: 400,
};

export const options = {
  scenarios: {
    ingest_transactions: isSmoke ? smokeScenario : full50kScenario,
  },
  thresholds: isSmoke
    ? {
        http_req_duration: ['p(95)<5000'],
        http_req_failed: ['rate<0.01'],
        dropped_iterations: ['count==0'],
        http_429: ['count==0'],
        transactions_accepted: ['count>=50'],
      }
    : {
        http_req_duration: ['p(95)<5000'],
        http_req_failed: ['rate<0.01'],
        dropped_iterations: ['count==0'],
        http_429: ['count==0'],
        transactions_accepted: ['count>=50000'],
        unique_transactions: ['count>=50000'],
      },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
  const isSmokeRun = isSmoke;
  console.log(
    `[k6 setup] Iniciando prueba de carga (modo: ${isSmokeRun ? 'SMOKE' : 'FULL 54K / 30m'})`,
  );
  const env = setupLoadEnvironment();
  console.log(
    `[k6 setup] Target: ${env.baseUrl} | RunId: ${env.runId} | Tenant: ${env.tenantId} | Cuenta: ${env.bankAccountId} (${env.currency})`,
  );
  return env;
}

export default function (data) {
  const { payload } = generateTransactionPayload(
    data.runId,
    data.bankAccountId,
    data.currency,
    __VU,
    __ITER,
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
      tags: { name: 'PostTransaction' },
      timeout: '10s',
    },
  );

  if (response.status === 429) {
    http429.add(1);
  }

  const isAccepted = response.status === 201 || response.status === 200;

  check(response, {
    'transacción aceptada (200 o 201)': (r) => r.status === 200 || r.status === 201,
    'tiempo de respuesta < 5000ms': (r) => r.timings.duration < 5000,
  });

  if (isAccepted) {
    transactionsAccepted.add(1);
    uniqueTransactions.add(1);
  } else {
    console.error(
      `[k6 error] VU:${__VU} Iter:${__ITER} HTTP ${response.status} - ${response.body || '(cuerpo descartado)'}`,
    );
  }
}

export function teardown(data) {
  console.log('================================================================================');
  console.log(`[k6 teardown] Corrida finalizada para RUN_ID: ${data.runId}`);
  console.log(`[k6 teardown] TENANT_ID: ${data.tenantId}`);
  console.log(
    '[k6 teardown] Recuerda ejecutar la verificación de consistencia y eventos en Postgres:',
  );
  console.log(
    `  node scripts/verify-load-54.mjs --run-id ${data.runId} --email <SEED_ADMIN_EMAIL> --db-user <POSTGRES_USER>`,
  );
  console.log('================================================================================');
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
  const accepted = data.metrics.transactions_accepted
    ? data.metrics.transactions_accepted.values
    : {};
  const dropped = data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values : {};
  const rateLimitCount = data.metrics.http_429 ? data.metrics.http_429.values : {};

  return `
================================================================================
              REPORTE DE EJECUCIÓN K6 - INGESTA DE TRANSACCIONES (#54)
================================================================================
Total Peticiones HTTP:   ${httpReqs.count || 0} (Throughput: ${(httpReqs.rate || 0).toFixed(2)} req/s)
Transacciones Aceptadas: ${accepted.count || 0}
Peticiones 429:          ${rateLimitCount.count || 0} -> ${rateLimitCount.count === 0 ? 'PASS [OK]' : 'FAIL'}
Iteraciones Caídas:      ${dropped.count || 0} -> ${dropped.count === 0 ? 'PASS [OK]' : 'FAIL'}
Tasa de Fallo HTTP:      ${((reqFailed.rate || 0) * 100).toFixed(2)}% -> ${(reqFailed.rate || 0) < 0.01 ? 'PASS [OK]' : 'FAIL'}
Latencia Media:          ${(reqDuration.avg || 0).toFixed(2)} ms
Latencia Mediana (p50):  ${(reqDuration.med || 0).toFixed(2)} ms
Latencia p90:            ${(reqDuration['p(90)'] || 0).toFixed(2)} ms
Latencia p95 (Límite 5s):${(reqDuration['p(95)'] || 0).toFixed(2)} ms  -> ${(reqDuration['p(95)'] || 0) < 5000 ? 'PASS [OK]' : 'FAIL'}
Latencia p99:            ${(reqDuration['p(99)'] || 0).toFixed(2)} ms
Latencia Máxima:         ${(reqDuration.max || 0).toFixed(2)} ms
================================================================================
`;
}
