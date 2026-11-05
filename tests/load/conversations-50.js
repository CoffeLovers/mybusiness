/**
 * Prueba de carga conversacional: 50 conversaciones concurrentes (issue #82).
 *
 * Arnés k6 del sprint QA para el canal conversacional del gateway
 * (`POST /api/v1/agent/chat`). Target = gateway (sin PayPal ni LLM externo);
 * umbral de latencia conmutables por escenario:
 *
 *   - Sin LLM (proveedor mock / degradado determinista): p95 < 3000 ms.
 *   - Con LLM (sandbox): p95 < 8000 ms (WITH_LLM=true).
 *
 * Reutiliza el patrón de autenticación compat de `tests/load/lib/setup.js`
 * (mismo set de variables BASE_URL / AUTH_TOKEN / TENANT_ID /
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), sin tocar el gateway ni el
 * arnés de ingesta de finanzas.
 *
 * Ejecución:
 *   k6 run tests/load/conversations-50.js
 *   k6 run tests/load/conversations-50.js -e WITH_LLM=true \
 *     --summary-export=results-conversations-llm.json
 *
 * Notas de configuración del stack real:
 *   El endpoint `POST /agent/chat` del gateway usa el grupo de throttle
 *   `heavy` (10/min por usuario). Para sostener 50 conversaciones
 *   concurrentes, levanta el gateway con THROTTLE_HEAVY_LIMIT=1000
 *   (override documentado en `docs/qa/load-report-54.md`, sección 3).
 *   Sin override, el arnés registra los 429 con `agent_rate_limited` y el
 *   criterio de éxito son los checks (no aborta por rate limit).
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const CONVERSATIONS = Number(__ENV.CONVERSATIONS || '50');
const MESSAGES_PER_CONVERSATION = Number(__ENV.MESSAGES_PER_CONVERSATION || '3');
const WITH_LLM = (__ENV.WITH_LLM || 'false') === 'true';
const CHAT_P95_LIMIT_MS = WITH_LLM ? 8000 : 3000;
const THINK_TIME_SECONDS = __ENV.THINK_TIME ? Number(__ENV.THINK_TIME) : 2;

const chatLatency = new Trend('agent_chat_duration', true);
const rateLimited = new Counter('agent_rate_limited');
const degradedResponses = new Counter('agent_degraded_responses');

export const options = {
  scenarios: {
    conversations: {
      executor: 'constant-vus',
      vus: CONVERSATIONS,
      duration: __ENV.LOAD_DURATION || '2m',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // Latencia del canal conversacional (umbral dinámico según escenario)
    [`http_req_duration{name:agent_chat}`]: [`p(95)<${CHAT_P95_LIMIT_MS}`],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>=0.95'],
  },
  tags: { issue: '82' },
};

/** Preguntas de la conversación: router determinista, sin PayPal. */
const QUESTIONS = [
  '¿Cuál es el flujo de caja del periodo 2026-01-01 al 2026-01-31?',
  '¿Qué transacciones quedan sin conciliar?',
  'Resume el saldo del periodo 2026-02-01 al 2026-02-28',
];

/**
 * Setup: reutiliza el patrón compat de `tests/load/lib/setup.js` (health
 * check + login o AUTH_TOKEN explícito). Devuelve el contexto de sesión.
 *
 * @returns {{ baseUrl: string, authToken: string, tenantId: string }}
 */
export function setup() {
  const loginRes = http.get(`${BASE_URL}/api/v1/health`, { responseType: 'text' });
  if (loginRes.status !== 200) {
    throw new Error(
      `Health check falló en ${BASE_URL}/api/v1/health: HTTP ${loginRes.status} - ${loginRes.body}`,
    );
  }

  let authToken = __ENV.AUTH_TOKEN;
  let tenantId = __ENV.TENANT_ID || '';

  if (!authToken) {
    const email = __ENV.SEED_ADMIN_EMAIL;
    const password = __ENV.SEED_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'Faltan variables SEED_ADMIN_EMAIL y/o SEED_ADMIN_PASSWORD para autenticación en stack real',
      );
    }

    const login = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ email, password }), {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'text',
    });

    if (login.status !== 200 && login.status !== 201) {
      throw new Error(`Login falló en ${BASE_URL}/api/v1/auth/login: HTTP ${login.status}`);
    }

    const loginBody = login.json();
    const session = loginBody.data ?? loginBody;
    authToken = session.accessToken;
    tenantId = session.user?.tenantId ?? '';

    if (!authToken || !tenantId) {
      throw new Error(`Respuesta de login inválida: ${JSON.stringify(loginBody)}`);
    }
  }

  return { baseUrl: BASE_URL, authToken, tenantId };
}

/**
 * Una conversación del VU: mensajes con think time y verificación del
 * contrato perimetral del chat.
 *
 * @param {{ authToken: string, baseUrl: string }} context
 */
export default function (context) {
  group('conversacion', () => {
    for (let index = 0; index < MESSAGES_PER_CONVERSATION; index += 1) {
      const message = QUESTIONS[index % QUESTIONS.length];
      const res = http.post(`${context.baseUrl}/api/v1/agent/chat`, JSON.stringify({ message }), {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${context.authToken}`,
        },
        tags: { name: 'agent_chat' },
      });

      chatLatency.add(res.timings.duration);

      if (res.status === 429) {
        // Rate limit del throttle `heavy`: se registra aparte y no contamina
        // el umbral de `checks`. Levantar THROTTLE_HEAVY_LIMIT sala el stack en
        // producción para que esta prueba refleje latencia y no profundidad
        // de la cola del throttler.
        rateLimited.add(1);
        sleep(THINK_TIME_SECONDS);
        continue;
      }

      check(res, { 'chat devuelve 200': (r) => r.status === 200 });

      let body = null;
      try {
        body = res.json();
      } catch {
        body = null;
      }
      if (body && body.degraded === true) {
        degradedResponses.add(1);
      }
      if (body && body.usage) {
        check(body.usage, {
          'presupuesto informado': (usage) => typeof usage.budgetRemainingMicroUsd === 'number',
        });
      }

      sleep(THINK_TIME_SECONDS);
    }
  });
}
