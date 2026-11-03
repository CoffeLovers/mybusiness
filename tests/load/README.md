# Pruebas de Carga de Ingesta Masiva de Transacciones (Issue #54 - SF2-12)

Escenario de prueba de carga con [k6](https://k6.io/) para verificar la capacidad del sistema de procesar un flujo masivo de **50.000 transacciones en 30 minutos** contra el stack real con aislamiento por tenant, deduplicación por clave de idempotencia y cero pérdida de eventos.

> [!IMPORTANT]
> **Distinción entre Stack Real y Mock**:
>
> - La aceptación formal de la issue #54 (Opción A) exige ejecutar la prueba de carga contra el **stack real** (`api-gateway`, `auth-service`, `finance-service`, `audit-service`, PostgreSQL y Redis).
> - La ejecución contra el **mock gateway** (`apps/web/e2e/mock-gateway.mjs`) sirve **exclusivamente como smoke test del arnés k6** en entornos locales/CI sin infraestructura Docker, y **no constituye evidencia de aceptación de SLAs de producción**.

---

## 1. Métricas y Criterios de Aceptación (SLAs)

| Métrica                | Umbral Exigido            | Verificación                                                          |
| :--------------------- | :------------------------ | :-------------------------------------------------------------------- |
| **Volumen Aceptado**   | `>= 50.000` transacciones | k6 counter `transactions_accepted >= 50000`                           |
| **Volumen Persistido** | `>= 50.000` transacciones | PostgreSQL `finance_db.transactions` con `idem-<run>-tx-%`            |
| **Latencia p95**       | `< 5.000 ms`              | k6 summary `http_req_duration.p(95) < 5000`                           |
| **Tasa de Error HTTP** | `< 1%` (`rate < 0.01`)    | k6 summary `http_req_failed.rate < 0.01`                              |
| **Peticiones 429**     | `count == 0`              | k6 counter `http_429 == 0`                                            |
| **Iteraciones Caídas** | `count == 0`              | k6 metric `dropped_iterations == 0`                                   |
| **Pérdida de Eventos** | `0%`                      | PostgreSQL `audit_logs` vs `finance_db.transactions` para el `RUN_ID` |
| **Dead Letters**       | `0`                       | PostgreSQL `audit_dead_letters` en la ventana del run                 |
| **Idempotencia**       | Clave única               | Replays devuelven HTTP 201 con el mismo `id` e importe inalterado     |

---

## 2. Prerrequisitos

1. **k6 instalado**:
   - Windows: Binario `k6.exe` (v0.50+) disponible en el `PATH` o instalado con:
     ```powershell
     winget install --id GrafanaLabs.k6 -e
     ```
   - Linux:
     ```bash
     sudo apt-get install k6
     ```
2. **Infraestructura Docker**:
   - Docker Desktop / daemon en ejecución para PostgreSQL 16 y Redis 7 (`pnpm docker:up`).
3. **Servicios del Stack Real**:
   - Migraciones y seeds ejecutados:
     ```powershell
     pnpm --filter @mybusiness/auth-service db:migrate
     pnpm --filter @mybusiness/finance-service db:migrate
     pnpm --filter @mybusiness/audit-service db:migrate
     pnpm --filter @mybusiness/auth-service db:seed
     ```
   - Microservicios en ejecución: `dev:auth`, `dev:finance`, `dev:audit` y `dev:gateway`.

---

## 3. Variables de Entorno Configurables

| Variable              | Por Defecto             | Descripción                                                           |
| :-------------------- | :---------------------- | :-------------------------------------------------------------------- |
| `BASE_URL`            | `http://127.0.0.1:3000` | URL base del API Gateway real (puerto 3200 si es mock)                |
| `RUN_ID`              | `load54-<timestamp>`    | Identificador único de corrida para trazabilidad e idempotencia       |
| `SEED_ADMIN_EMAIL`    | _(requerido en real)_   | Email del usuario administrador para login real                       |
| `SEED_ADMIN_PASSWORD` | _(requerido en real)_   | Contraseña del usuario administrador para login real                  |
| `LOAD_CURRENCY`       | `COP`                   | Divisa de la cuenta bancaria para la carga                            |
| `AUTH_TOKEN`          | _(opcional)_            | Token Bearer para bypass de login (solo modo compatibilidad con mock) |
| `SMOKE`               | `false`                 | `true` ejecuta un smoke reducido (10 segundos)                        |

---

## 4. Procedimiento de Ejecución Real

### Paso 1: Configuración de Límites para la Prueba

En las sesiones de los procesos o archivo `.env` temporal:

```powershell
$env:JWT_EXPIRES_IN      = '60m'
$env:THROTTLE_API_LIMIT  = '1000000'
$env:THROTTLE_AUTH_LIMIT = '100'
$env:THROTTLE_HEAVY_LIMIT= '1000'
```

### Paso 2: Probe de Idempotencia Pre-Carga

```powershell
$env:RUN_ID = "load54-" + (Get-Date -Format "yyyyMMdd-HHmmss")

k6 run `
  -e BASE_URL=http://127.0.0.1:3000 `
  -e RUN_ID=$env:RUN_ID `
  -e SEED_ADMIN_EMAIL=$env:SEED_ADMIN_EMAIL `
  -e SEED_ADMIN_PASSWORD=$env:SEED_ADMIN_PASSWORD `
  -e LOAD_CURRENCY=COP `
  tests/load/idempotency-check.js
```

### Paso 3: Ingesta Masiva de 54.000 Transacciones (30 minutos)

Ejecuta el escenario `constant-arrival-rate` a 30 req/s durante 30 minutos:

```powershell
k6 run `
  -e BASE_URL=http://127.0.0.1:3000 `
  -e RUN_ID=$env:RUN_ID `
  -e SEED_ADMIN_EMAIL=$env:SEED_ADMIN_EMAIL `
  -e SEED_ADMIN_PASSWORD=$env:SEED_ADMIN_PASSWORD `
  -e LOAD_CURRENCY=COP `
  tests/load/ingest-50k.js
```

### Paso 4: Verificación Automatizada en PostgreSQL

```powershell
node scripts/verify-load-54.mjs `
  --run-id $env:RUN_ID `
  --email $env:SEED_ADMIN_EMAIL `
  --db-user $env:POSTGRES_USER
```

Este script evalúa los 11 criterios obligatorios en `finance_db` y `audit_db`, esperando la estabilización del consumidor asíncrono, y emite `tests/load/verification-54.json`.

---

## 5. Estructura de Archivos

- `ingest-50k.js`: Escenario de carga k6 a 30 req/s x 30 min (o smoke con `SMOKE=true`).
- `idempotency-check.js`: Probe de idempotencia (1 VU / 1 iteración) para validar consistencia de replays HTTP 201.
- `lib/setup.js`: Login real en gateway, resolución dinámica de tenant y cuenta bancaria.
- `lib/idempotency.js`: Generador de claves deterministas `idem-${runId}-tx-${vu}-${iter}` y payloads probe.
- `k6-summary.json`: Métricas generadas por k6 al finalizar la corrida.
- `verification-54.json`: Resultado de la auditoría en base de datos generado por `verify-load-54.mjs`.
