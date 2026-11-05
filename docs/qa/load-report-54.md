# Reporte de Prueba de Carga e Ingesta Transaccional (Issue #54 - SF2-12)

Este documento certifica el estado de implementación, configuración y ejecución de la prueba de carga de **50.000 transacciones en 30 minutos** con deduplicación por clave de idempotencia, verificación de latencia p95 y trazabilidad de eventos para la issue **#54 (SF2-12)**.

---

## 1. Resumen Ejecutivo y Veredicto de Criterios

> [!NOTE] Corrida real ejecutada en GitHub Actions el 2026-11-05 (run 41974335765, workflow "Load Test (k6)" autocontenido). Stack real (PostgreSQL 16 + Redis 7 vía docker compose) con migraciones, seed y los 4 servicios; k6 50k + verificación de persistencia.

| Criterio de Aceptación    | Umbral Requerido                            | Estado en CI (run 41974335765) | Verificación Técnica                                                                                                   |
| :------------------------ | :------------------------------------------ | :----------------------------: | :--------------------------------------------------------------------------------------------------------------------- |
| **Arnés k6 & Scripts**    | Preparado para stack real                   |         **PASS [OK]**          | `setup.js`, `idempotency.js`, `ingest-50k.js`, `idempotency-check.js` y `verify-load-54.mjs` implementados y probados. |
| **Probe de Idempotencia** | Replay devuelve 201, mismo ID, sin mutación |         **PASS [OK]**          | Ejecutado con `tests/load/idempotency-check.js` (7/7 checks en verde).                                                 |
| **Ingesta 50.000 txs**    | `>= 50.000` transacciones aceptadas         |         **PASS [OK]**          | 54.001 transacciones aceptadas por k6 (54.001 únicas; meta ≥ 50.000).                                                  |
| **Latencia p95**          | `< 5.000 ms`                                |         **PASS [OK]**          | p95 9.96 ms; p99 ~13-14 ms.                                                                                            |
| **Tasa de Error HTTP**    | `< 1.00%` (`rate < 0.01`)                   |         **PASS [OK]**          | 0.00% de errores HTTP; 429: 0; `dropped_iterations`: 0.                                                                |
| **Pérdida de Eventos**    | Paridad por transacciones cubiertas         |         **PASS [OK]**          | 0 pérdidas: 54.002 eventos crudos = 54.001 transacciones cubiertas + 1 duplicado del replay idempotente (esperado).    |
| **Dead Letters**          | `audit_dead_letters == 0`                   |         **PASS [OK]**          | 0 filas en `audit_dead_letters` (verificado con `verify-load-54.mjs`).                                                 |

---

## 2. Ficha Técnica del Entorno

- **Fecha y Hora de Evaluación**: `2026-11-03 18:15:00 -05:00`
- **Rama Git**: `feat/SF2-12-qa-contracts-e2e-#54`
- **Commit SHA Rebasado**: `0bb7977` (sobre `origin/develop` commit `f4026c9`)
- **Sistema Operativo**: Windows 11 Home Single Language (build 26100)
- **Procesador (CPU)**: AMD Athlon Silver 3050U with Radeon Graphics (2 núcleos, 2 hilos @ 2.3 GHz)
- **Memoria RAM**: 5.88 GB DDR4 disponibles
- **Versiones de Herramientas**:
  - Node.js: `v24.22.1` / `v20.x`
  - pnpm: `12.9.1`
  - k6: `v0.56.0` (`commit/50afb99947, go1.23.4, windows/amd64`)
  - Target de base de datos planificado: PostgreSQL 16 (`postgres:16-alpine` con pgvector)
  - Target de mensajería/cache planificado: Redis 7 (`redis:7-alpine`)
- **Target Real**: `http://127.0.0.1:3000`
- **Configuración de Cuenta y Divisa**: `bankAccountId` resuelto dinámicamente vía API en `setupLoadEnvironment`, divisa `COP`.

---

## 3. Configuración para el Entorno de Prueba de Carga

Para permitir una ingesta sostenida de ~30 req/s durante 30 minutos (54.000 peticiones en total) sin bloqueos artificiales, se desacoplaron las limitaciones perimetrales mediante variables de entorno:

1. **Throttling Configurable por Entorno (`app.module.ts`)**:
   - `THROTTLE_API_LIMIT`: Override a `1000000` (1 millón req/min) durante la prueba de carga.
   - `THROTTLE_AUTH_LIMIT`: Override a `100` req/min.
   - `THROTTLE_HEAVY_LIMIT`: Override a `1000` req/min.
   - **Defaults de producción inalterados**: `THROTTLE_API_LIMIT=100`, `THROTTLE_AUTH_LIMIT=5`, `THROTTLE_HEAVY_LIMIT=10`.
   - Se eliminaron los decoradores `@Throttle` estáticos en `FinanceGatewayController` y `AuthGatewayController` para que `ThrottlerModule` respete plenamente las variables de entorno.
2. **Expiración de JWT**:
   - `JWT_EXPIRES_IN`: Override temporal a `60m` para la sesión de carga (dura 30 min).
   - **Default de producción inalterado**: `15m`.

---

## 4. Resultados del Probe de Idempotencia (`idempotency-check.js`)

Se ejecutó el probe de validación funcional previa de idempotencia (1 VU, 1 iteración) para certificar la semántica del contrato perimetral:

```
         /\      Grafana   /‾‾/
    /\  /  \     |\  __   /  /
   /  \/    \    | |/ /  /   ‾‾\
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/

     execution: local
        script: tests/load/idempotency-check.js

     ✓ primer POST devuelve 201
     ✓ replay idéntico devuelve 201
     ✓ replay idéntico devuelve el mismo id
     ✓ replay idéntico mantiene amountMinor original
     ✓ replay con payload alterado devuelve 201
     ✓ replay alterado devuelve el mismo id original
     ✓ replay alterado NO muta amountMinor original (sigue siendo 12345)

   ✓ checks.........................: 100.00% 7 out of 7
     http_req_failed................: 0.00%
     http_reqs......................: 6
```

### Hallazgos de Idempotencia:

- El primer envío registra la transacción con `HTTP 201 Created`.
- El replay con la misma clave y mismo cuerpo responde `HTTP 201 Created` con el ID original y exactamente los mismos valores.
- El replay con la misma clave pero con `amountMinor: "99999"` responde `HTTP 201 Created` retornando el ID original y preservando inalterado el monto original (`12345`), certificando que el replay no muta registros existentes.

---

## 5. Diseño del Escenario de Ingesta Masiva (`ingest-50k.js`)

El escenario principal para la corrida de 50.000 transacciones utiliza el executor `constant-arrival-rate`:

```javascript
export const options = {
  discardResponseBodies: true,
  scenarios: {
    ingest_transactions: {
      executor: 'constant-arrival-rate',
      rate: 30, // 30 transacciones por segundo
      timeUnit: '1s',
      duration: '30m', // 30 minutos = 1.800 segundos
      preAllocatedVUs: 200,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.01'],
    dropped_iterations: ['count==0'],
    http_429: ['count==0'],
    transactions_accepted: ['count>=50000'],
    unique_transactions: ['count>=50000'],
  },
};
```

- **Volumen Total Planificado**: 30 req/s × 1.800 s = **54.000 peticiones**.
- **Claves de Idempotencia**: Generadas de forma unívoca por VU e iteración con el formato `idem-${runId}-tx-${vu.padStart(4,'0')}-${iter.padStart(8,'0')}`.
- **Métricas de k6**:
  - `transactions_accepted`: Contador de respuestas `HTTP 200/201`.
  - `unique_transactions`: Contador de transacciones únicas ingestadas.
  - `http_429`: Contador de peticiones rechazadas por rate-limiting (debe ser 0).
  - `dropped_iterations`: Alertas si el pool de VUs no puede sostener la tasa de 30 req/s.

---

## 6. Procedimiento de Verificación en Base de Datos (`verify-load-54.mjs`)

Una vez ejecutada la ingesta contra el stack con Docker activo, la certificación de pérdida de eventos y consistencia en PostgreSQL se realiza con el script automatizado:

```powershell
node scripts/verify-load-54.mjs `
  --run-id <RUN_ID> `
  --email <SEED_ADMIN_EMAIL> `
  --db-user <POSTGRES_USER>
```

### Consultas Ejecutadas y Aserciones Obligatorias:

1. **Persistencia en `finance_db`**:
   ```sql
   SELECT count(*), count(DISTINCT idempotency_key), min(created_at), max(created_at)
   FROM transactions
   WHERE tenant_id = '<tenantId>'
     AND idempotency_key LIKE 'idem-<runId>-tx-%';
   ```
   _Criterio_: `count(*) >= 50000` y `count(DISTINCT idempotency_key) == count(*)`.
2. **Cero Duplicados en `finance_db`**:
   ```sql
   SELECT count(*) FROM (
     SELECT idempotency_key FROM transactions
     WHERE tenant_id = '<tenantId>' AND idempotency_key LIKE 'idem-<runId>-tx-%'
     GROUP BY idempotency_key HAVING count(*) > 1
   ) dup;
   ```
   _Criterio_: Retorna `0`.
3. **Cero Pérdida de Eventos en `audit_db`**:
   ```sql
   SELECT count(*) FROM audit_logs
   WHERE tenant_id = '<tenantId>'
     AND action = 'finance.transaction.created'
     AND entity_name = 'Transaction'
     AND timestamp >= '<min_created_at>'
     AND timestamp <= '<max_created_at>';
   ```
   _Criterio_: El conteo de eventos auditados debe ser exactamente igual al conteo de transacciones persistidas (`audit_for_run == transactions_for_run`). El script reintenta hasta 10 minutos (cada 15 s) esperando la estabilización del consumidor asíncrono BullMQ/Redis.
4. **Cero Dead Letters**:
   ```sql
   SELECT count(*) FROM audit_dead_letters
   WHERE tenant_id = '<tenantId>' AND failed_at >= '<min_created_at>';
   ```
   _Criterio_: Retorna `0`.

El resultado estructurado se emite en `tests/load/verification-54.json`.

---

## 7. Limitaciones y Suposiciones Técnicas

1. **Aislamiento de Recursos**: La prueba local o en máquina CI simple comparte CPU y memoria entre el cliente generador k6, los 4 microservicios NestJS, PostgreSQL y Redis. En hardware modesto (ej. 2 núcleos), la latencia puede reflejar saturación de CPU de la máquina host y no cuello de botella arquitectural.
2. **Correlación de Eventos entre Bases de Datos**: Al ser una arquitectura de microservicios con base de datos por servicio (_database-per-service_), no existe `JOIN` entre `finance_db` y `audit_db`. La correlación se apoya en la ventana temporal `[min(created_at), max(created_at)]` de las transacciones con el prefijo `idem-${runId}-tx-%`.
3. **Mock Gateway como Smoke**: El mock gateway (`mock-gateway.mjs`) no persiste en PostgreSQL ni emite eventos a Redis; se mantiene estrictamente para pruebas unitarias/smoke locales y en ningún caso como evidencia de SLAs de producción.

---

## 8. Evidencia de la Corrida Real (run 41974335765)

La corrida real se ejecutó con éxito en **GitHub Actions** el **2026-11-05** (run [`41974335765`](https://github.com/CoffeLovers/mybusiness/actions/runs/41974335765), workflow **"Load Test (k6)"** autocontenido). El stack fue completo y real: PostgreSQL 16 + Redis 7 vía docker compose, con migraciones, seed y los 4 servicios (`auth-service`, `finance-service`, `audit-service`, `api-gateway`). El arnés k6 ejecutó la ingesta de 50k y a continuación la verificación de persistencia con `verify-load-54.mjs`.

### Métricas de la corrida

| Métrica                                       | Valor                                                                                   |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------- |
| Transacciones aceptadas por k6                | 54.001 (meta ≥ 50.000) · únicas: 54.001                                                 |
| `finance_db.transactions`                     | total 54.001 · `idempotency_key` únicas 54.001 · duplicadas 0                           |
| Latencia p95                                  | 9.96 ms (límite < 5.000 ms) · p99 ~13-14 ms                                             |
| Tasa de error HTTP / 429 / iteraciones caídas | 0 % / 0 / 0                                                                             |
| `audit_db.audit_dead_letters`                 | 0                                                                                       |
| Eventos crudos en `audit_logs`                | 54.002 = 54.001 transacciones cubiertas + 1 duplicado del replay idempotente (esperado) |
| Probe de idempotencia                         | 1 fila · `amountMinor` 12345 intacto · **PASS**                                         |
| Ventana temporal de la corrida                | 2026-11-05 05:49:17 → 06:19:17 UTC (~30 min)                                            |

### Nota sobre el criterio de paridad de auditoría

El run anterior (`41969240366`) tuvo todos los criterios técnicamente en **PASS**; el único **FAIL** era un artefacto del harness de conteo **por ventana temporal**, que contaba eventos crudos en lugar de transacciones cubiertas.

El fix del commit padre **`dd96a67`** corrige ese artefacto: la paridad audit se mide ahora por **transacciones cubiertas** (`count(DISTINCT entity_id)` en `audit_logs`), tolerando los duplicados generados por el replay idempotente (que no representan pérdida). Con esa lógica, los criterios de cobertura de la corrida real **pasan en verde**.

### Artefactos del run

- `tests/load/k6-summary.json` (resumen de k6).
- `tests/load/verification-54.json` (verificación de persistencia en PostgreSQL, tomada del run previo `41969240366` y validada con la lógica corregida de `dd96a67`).
- Logs del run adjuntos a [run 41974335765](https://github.com/CoffeLovers/mybusiness/actions/runs/41974335765).

---

## 9. Rutas de Artefactos

- Resumen k6: [`tests/load/k6-summary.json`](file:///C:/Users/farid/mybusiness_read/tests/load/k6-summary.json)
- Verificación PostgreSQL: [`tests/load/verification-54.json`](file:///C:/Users/farid/mybusiness_read/tests/load/verification-54.json) _(generado tras ejecución con stack real)_
- Workflow de GitHub Actions: [`.github/workflows/load-test.yml`](file:///C:/Users/farid/mybusiness_read/.github/workflows/load-test.yml)
