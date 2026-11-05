# Reporte QA Conversacional y Contract Tests MCP (Issue #82 - SF3-12)

Este documento describe el estado de implementación, configuración y ejecución de los elementos de QA **no dependientes de infraestructura sandbox** de la issue **#82 (SF3-12)**: E2E conversacional del agente, contract tests del servidor MCP y arnés k6 de carga de 50 conversaciones concurrentes con el proveedor LLM simulado.

> [!IMPORTANT] Corrida real pendiente de run
> Secciones 4 y 5 de resultados completadas con **"[pendiente de run]"**: no se ha ejecutado aún la carga contra un stack real con Docker (gateway + agent-service + PostgreSQL 16 + Redis 7), ni la campaña con LLM en sandbox. No se reportan cifras inventadas.

---

## 1. Resumen Ejecutivo de Criterios

| Criterio de Aceptación (#82)                                                         |  Estado en esta rama   | Verificación                                                                                         |
| :----------------------------------------------------------------------------------- | :--------------------: | :--------------------------------------------------------------------------------------------------- |
| La prueba de carga sostiene **50 conversaciones concurrentes** con p95 < 3 s sin LLM |  `[pendiente de run]`  | Arnés implementado (`tests/load/conversations-50.js`, validado sintácticamente; sin stack real aún)  |
| ...con p95 < 8 s **con LLM (sandbox)**                                               |  `[pendiente de run]`  | Modo `WITH_LLM=true` del arnés; requiere sandbox de proveedor                                        |
| Con **presupuesto agotado responde degradado y no llama al proveedor**               | Cubierto por E2E mock  | `apps/web/e2e/agent-chat.spec.ts` (estados `BUDGET_EXHAUSTED` + contador de llamadas al proveedor)   |
| **Contract tests MCP** fallan si el esquema cambia sin actualizar el cliente         |   **PASS** (vitest)    | `apps/agent-service/test/mcp-contract.spec.ts` + snapshot `test/fixtures/mcp-tools-list.v1.0.0.json` |
| E2E de chat (login → pregunta → cita → presupuesto actualizado) en **CI con Docker** |  `[pendiente de run]`  | Spec implementado; el flujo UI completo de `/agente` depende de la pantalla del sprint de UI         |
| Un **webhook duplicado** no altera el estado ni duplica la conciliación (PayPal)     | `[pendiente: sandbox]` | Cubierto por unitarias de #79; E2E PayPal requires PP sandbox en integración, pendiente por plan     |
| E2E Android con biometría (sin biometría no hay captura)                             |  `[pendiente: infra]`  | Requiere emulador con credencial biométrica enrolada; fuera de esta rama (documentado abajo)         |

---

## 2. Implementación en esta rama (sin infra sandbox)

### 2.1 E2E conversacional Playwright (`apps/web/e2e/agent-chat.spec.ts`)

Siguiendo la directriz de QA **"no construir pantallas de producto nuevas en una issue de QA"** (`docs/qa/e2e-matrix.md`, deuda #54), el canal principal es el **cliente de peticiones HTTP de Playwright** contra el gateway falso (`mock-gateway.mjs`), que ahora replica el contrato perimetral exacto de `POST /api/v1/agent/chat` (`AgentChatResponseDto`):

- Extensión **aditiva** del mock con estado en memoria **por tenant**: caché semántica determinista, memoria conversacional, presupuesto mensual de 2.000.000 µUSD, y contador de llamadas al proveedor LLM (`/api/v1/agent/dev/stats`, endpoint sólo de QA).
- Escenarios cubiertos:
  1. **Flujo feliz "con stub LLM"**: login UI real → pregunta con fechas → cita `source: tool` (`get_cashflow_summary`) → respuesta fundamentada con las cifras del dashboard del tenant → `usage.budgetRemainingMicroUsd` decrece y persiste en `GET /api/v1/agent/budget`.
  2. **"Sin LLM"**: herramientas caídas (`ALL_TOOLS_FAILED`) → respuesta degradada determinista, costo 0 y **0 llamadas al proveedor** (verificado vía `dev/stats`).
  3. **Presupuesto agotado**: (con mensaje de control `agotar presupuesto` o header `X-E2E-Scenario: budget-exhausted`) → `degraded: true, code: BUDGET_EXHAUSTED`, citas vacías, costo 0, proveedor nunca invocado.
  4. **RBAC**: rol `VIEWER` recibe `403 insufficient_permissions`.
  5. **Aislamiento por tenant A/B**: sesiones de navegador separadas, mismo pedido → cifras propias por tenant, sin fugas (A jamás ve `99.000,00 €` de B y viceversa), y la memoria de A nunca aparece en las respuestas de B.
  6. **A11y**: página `/login` (canal UI disponible) sin violaciones axe bloqueantes WCAG 2.x A/AA.

- **Deuda documentada (test harness)**:
  - La pantalla `/agente` (chat en browser) no existe todavía en `apps/web` (sprint de UI pendiente). Al aterrizar, se replica este spec sobre la página y se añade el análisis axe específico de la pantalla; el contrato ya está congelado por estos tests, de modo que la integración UI es de composición, no de reescritura.
  - El stub de PayPal en `create_payment_link` responde una URL sandbox simulada (sin llamar a PayPal); no constituye validación de dinero.

### 2.2 Contract tests MCP versionados (`apps/agent-service/test/mcp-contract.spec.ts`)

Snapshot JSON versionado (`mcp-tools-list.v1.0.0.json`) para el `tools/list` del servidor MCP:

- Igualdad exacta entre el catálogo vigente (`MCP_TOOLS` + `MCP_SCHEMA_VERSION`) y el snapshot; incluye la herramienta `create_payment_link` de la stack #78.
- Invariantes: `type: object`, `additionalProperties: false`, `required ⊆ properties`, `version` semver, `amountMinor` siempre string entero positivo (`^[1-9][0-9]*$`), y ausencia de datos de tenant/credenciales en el snapshot.
- En divergencia el test falla con instrucciones explícitas: incrementar `MCP_SCHEMA_VERSION`, crear snapshot nuevo y **actualizar el cliente consumidor del MCP** antes de mergear. Nunca se sobrescribe la versión previa.

### 2.3 Arnés k6 conversacional (`tests/load/conversations-50.js`)

- **Carga objetivo**: 50 conversaciones concurrentes (`executor: constant-vus`, `CONVERSATIONS`, `LOAD_DURATION`, configurable), 3 mensajes por conversación con think time (`THINK_TIME`).
- **Verbosidad del arnés**: `POST /api/v1/agent/chat` del gateway (sin PayPal); mismo patrón compat de autenticación de `lib/setup.js` (`AUTH_TOKEN`/`TENANT_ID` o `SEED_ADMIN_EMAIL/PASSWORD` con health check previo).
- **Métricas propias**: `agent_chat_duration` (Trend), `agent_rate_limited` (Counter, 429), `agent_degraded_responses` (Counter, `degraded:true`), y verificación de `usage.budgetRemainingMicroUsd` en cada respuesta.
- **Thresholds conmutables**: p95 < 3000 ms por defecto (sin LLM) y p95 < 8000 ms con `WITH_LLM=true`; `http_req_failed < 0.05`, `checks >= 0.95`.
- **Validado sintácticamente** bajo Node ESM (`node --check` sobre copia `.mjs`) y k6 v0.56.0 instalado en la workstation; la primera corrida real queda pendiente (sección 4).

### 2.4 Smoke de validación previa (1 VU)

Dentro del mismo arnés: `CONVERSATIONS=1 LOAD_DURATION=1s THINK_TIME=1 smoke` permite sanity-check funcional contra el stack antes de lanzar la carga. El plan de corrida recomendado (sección 3.3) respeta ese orden.

---

## 3. Instrucciones de ejecución

### 3.1 E2E Playwright (sin servicios externos: webServer propio + mock)

```bash
# Desde la raíz (arranca Next + mock-gateway automáticamente):
pnpm --filter @mybusiness/web exec playwright test e2e/agent-chat.spec.ts

# Suite completa de web (incluye los specs existentes):
pnpm --filter @mybusiness/web test
```

### 3.2 Contract tests MCP (CI)

```bash
pnpm --filter @mybusiness/agent-service test
# El spec nuevo: apps/agent-service/test/mcp-contract.spec.ts corre con las
# unitarias existentes; en CI, el job que ejecuta las unitarias de agent-service es
# suficiente para bloquear PRs que muten el esquema sin snapshot nuevo.
```

### 3.3 Carga conversacional k6 (requiere stack con Docker)

```bash
# 1) Levantar infra + servicios con throttle heavy elevado (documentado en #54):
#    THROTTLE_HEAVY_LIMIT=1000 (default de producción: 10 req/min por usuario en /agent/chat)
#    JWT_EXPIRES_IN=120m para sesiones largas de carga.
pnpm docker:up && pnpm dev:gateway & pnpm dev:agent

# 2) Smoke funcional (1 conversación):
k6 run tests/load/conversations-50.js \
  -e CONVERSATIONS=1 -e LOAD_DURATION=1m -e THINK_TIME=1 \
  --summary-export=results-conversations-smoke.json

# 3) Carga nominal sin LLM (p95 < 3 s):
k6 run tests/load/conversations-50.js \
  --summary-export=results-conversations-nollm.json

# 4) Campaña con LLM sandbox (p95 < 8 s):
k6 run tests/load/conversations-50.js -e WITH_LLM=true \
  --summary-export=results-conversations-llm.json
```

Ambiente requerido por el arnés (idéntico a `lib/setup.js`): `BASE_URL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, o en su lugar `AUTH_TOKEN` + `TENANT_ID`.

---

## 4. Resultados de la carga conversacional

> [!WARNING] [pendiente de run]
> Tablas intencionadamente vacías. Rellenar sólo con export reales de `--summary-export`.

| Métrica                  | Umbral                            | [pendiente de run] | [pendiente de run] WITH_LLM |
| :----------------------- | :-------------------------------- | :----------------- | :-------------------------- |
| p95 conversación         | < 3.000 ms / < 8.000 ms           | _                  | _                           |
| p99                      | informativo                       | _                  | _                           |
| http_req_failed          | < 0.05                            | _                  | _                           |
| checks                   | >= 0.95                           | _                  | _                           |
| agent_rate_limited       | 0 (con THROTTLE_HEAVY_LIMIT=1000) | _                  | _                           |
| agent_degraded_responses | 0 (presupuesto no agotado)        | _                  | _                           |

---

## 5. Resultados del contract test MCP

| Verificación                                                                                | Estado                                                                               |
| :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------- |
| Snapshot `v1.0.0` existe y declara la `schemaVersion` vigente                               | **PASS (vitest)**                                                                    |
| `tools/list` coincide exactamente con el snapshot (3 tools, incluida `create_payment_link`) | **PASS (vitest)**                                                                    |
| Invariantes de esquema JSON (`additionalProperties:false`, `required ⊆ properties`)         | **PASS (vitest)**                                                                    |
| Sin datos de tenant/credenciales en el snapshot                                             | **PASS (vitest)**                                                                    |
| Escenario de drift: falla con mensaje "actualiza el snapshot y el cliente"                  | Cubierto por diseño `toEqual` + mensaje de instrucciones en `contractDriftMessage()` |

(Validado con `pnpm --filter @mybusiness/agent-service test`; mantener en verde en CI.)

---

## 6. Pendiente por infra / fuera de esta rama

1. **PayPal E2E completo** (factura → enlace → pago sandbox → webhook firmado → conciliación → reembolso aprobado + webhook duplicado + reembolso rechazado): requiere cuenta PayPal sandbox con credenciales aplicadas a recruit e infra de webhook expuesto; las unitarias/ENT de #79 cubren las gradas: en esta rama el stub del arnés evita tocar dinero.
2. **E2E Android de captura con biometría**: requiere emulador con credencial enrolada + device farm; no ejecutable en esta estación.
3. **Pantalla `/agente` en el portal web**: al entregarla, habilitar el flujo UI de este spec (actualmente el canal E2E es por contrato de API, deuda heredada de #54).
4. **Campaña con LLM real en sandbox** (`WITH_LLM=true`): requiere proveedor accesible y presupuesto de prueba.
5. **Jobs de CI** para carga k6 y contract MCP como workflow dedicado: en esta rama está prohibido editarlo (`.github/workflows/ci.yml` fuera de alcance de SF3-12); por ahora los contract tests corren en el job de unitarias de `agent-service`.

---

## 7. Orden de merge sugerido respecto a #78 / #79

1. **`develop` mantiene ambas ramas integradas** (commits `ea266be..0e99c57`); esta rama `feat/qa-conversational-#82` parte de ellas y **no toca** `packages/**`, `apps/finance-service/**`, `apps/api-gateway/**`, `apps/agent-service/src/**`, `docker/**` ni CI, por lo que puede mergear a `develop` **sin conflicto con las #78/#79** ni dependencias de orden.
2. Antes del primer E2E/carga real: asegurar en `develop` variables `.env` para el sandbox PayPal (para la deuda del punto 1 de la sección 6).
3. Merge recomendado: PR de esta rama → `develop` (referencia `Closes #82` parcial: pendencias listadas en sección 6 deben quedar en el cuerpo del PR y/o issue hija).
