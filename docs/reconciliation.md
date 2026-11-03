# Conciliación Automática y Cron Nocturno — SF2-11

> Motor determinista y explicable de conciliación entre movimientos bancarios (`bank_transactions`) y documentos/facturas (`documents` e `invoices`), con puntuación de confianza, umbral configurable por tenant, bandeja de revisión, cron nocturno por zona horaria y métricas agregadas.

---

## 1. Arquitectura y Componentes

El módulo de conciliación vive en `apps/finance-service/src/reconciliation/` y se compone de:

- **`ReconciliationMatcher` (`reconciliation.matcher.ts`)**: Motor funcional puro y sin dependencias externas para normalización de texto, similitud difusa (Levenshtein + solapamiento de tokens) y puntuación de candidatos.
- **`ReconciliationService` (`reconciliation.service.ts`)**: Servicio transaccional que orquesta el matching en lotes (`RECONCILIATION_BATCH_SIZE`, default 500), la persistencia idempotente, la bandeja de revisión y las métricas.
- **`ReconciliationScheduler` (`reconciliation.scheduler.ts`)**: Servicio de ciclo de vida que registra y actualiza los cron jobs nocturnos en BullMQ a las 02:00 AM (`0 2 * * *`) respetando la zona horaria de cada tenant.
- **`ReconciliationWorker` (`reconciliation.worker.ts`)**: Consumidor de la cola durable `reconciliation` en BullMQ. Sincroniza movimientos de las conexiones bancarias activas antes de ejecutar la conciliación.
- **`ReconciliationController` (`reconciliation.controller.ts`)**: Controladores RPC NestJS con los patrones definidos en `@mybusiness/contracts`.
- **API Gateway (`apps/api-gateway/src/reconciliation/`)**: Exposición REST con RBAC (`TENANT_ADMIN`, `ACCOUNTANT`), validación de contexto y manejo de errores.

---

## 2. Motor de Matching Puro

### 2.1 Reglas de Filtrado de Candidatos

Un par transacción bancaria / documento sólo se evalúa como candidato si cumple estrictamente:

1. **Monto idéntico en unidad mínima**: `abs(bankTransaction.amountMinor) === document.totalMinor`.
2. **Misma moneda**: Si ambos registros definen moneda (e.g. `COP`), deben coincidir exactamente.
3. **Ventana de fechas**: La diferencia absoluta entre la fecha del movimiento bancario y la fecha de emisión del documento no supera `dateWindowDays` (configurable por tenant, default 5 días).

### 2.2 Normalización de Texto

- Conversión a minúsculas y eliminación de acentos/diacríticos (`normalize('NFD')`).
- Normalización previa de acrónimos con puntos (ej. `S.A.S.` $\to$ `sas`).
- Eliminación de signos de puntuación y caracteres especiales.
- Eliminación de sufijos societarios comunes (`sas`, `sa`, `sl`, `slu`, `ltda`, `ltd`, `inc`, `llc`, `corp`, `corporation`, `gmbh`, `bv`, `cia`, `sucursal`, `esp`, `pty`).
- Exclusión de stopwords bancarias y de facturación (`pago`, `factura`, `transferencia`, `compra`, `de`, `la`, `el`, `y`, `en`).

### 2.3 Similitud de Contraparte

Función determinista en TypeScript puro que combina:

- Coincidencia exacta o contención de subcadena significativa.
- Coincidencia de siglas/acrónimos (ej. `ETB` $\leftrightarrow$ `Empresa de Telecomunicaciones de Bogota`).
- Solapamiento de palabras de marca distintiva ($\ge 4$ caracteres).
- Ratio de similitud por distancia de Levenshtein normalizada: $1 - \frac{\text{distancia}}{\max(L_1, L_2)}$.
- Se descartan similitudes espurias cuando no existen tokens compartidos y el ratio Levenshtein es menor a 0.45.

### 2.4 Fórmula de Puntuación (Score $0.000$ a $1.000$)

$$\text{Score} = 0.40 + \left(0.20 \times \left(1 - \frac{\Delta\text{días}}{\text{ventana}}\right)\right) + (0.30 \times \text{similitud\_contraparte}) + (0.10 \times \text{coincidencia\_factura})$$

- **Monto exacto**: Aporte fijo de `0.40`.
- **Cercanía de fecha**: Hasta `0.20`, decreciendo linealmente con la diferencia en días dentro de la ventana.
- **Similitud de contraparte**: Hasta `0.30`, proporcional a la similitud calculada.
- **Número de factura exacto**: Aporte de `0.10` si el número de factura normalizado del documento coincide con el extraído o referenciado en la transacción.

### 2.5 Criterio de Auto-Conciliación (`AUTO_MATCHED`) vs Revisión (`NEEDS_REVIEW`)

Un candidato califica a `AUTO_MATCHED` únicamente si:

1. El documento se encuentra en estado `DocumentStatus.EXTRACTED`.
2. La confianza OCR del documento cumple `confidence >= 0.85`.
3. El score total es mayor o igual al umbral configurado por el tenant (`autoMatchThresholdBps / 10000`, por defecto `0.85`).
4. **Ausencia de ambigüedad**: Si los dos mejores candidatos para una misma transacción tienen una diferencia de score menor a `0.05`, se clasifica como ambiguo y se envía a `NEEDS_REVIEW`.

Cualquier documento con confianza baja, estado `NEEDS_REVIEW` o score inferior al umbral pasa a la bandeja de revisión y **nunca** se auto-concilia.

---

## 3. Modelo de Datos y Migración 0005

La migración `0005_last_baron_strucker.sql` incorpora:

### 3.1 Columna en `documents`

- `documents.invoice_number` (`varchar(100)`, nullable): Normalizado desde Mindee OCR o generado por el stub de prueba (`FAC-DEMO-0001`).

### 3.2 Tabla `reconciliation_settings`

Configuraciones por tenant con valores por defecto:

- `tenant_id` (`uuid`, PK).
- `date_window_days` (`integer`, default 5, rango 1-30).
- `auto_match_threshold_bps` (`integer`, default 8500, rango 5000-10000, es decir 50% a 100%).
- `timezone` (`varchar(50)`, default `'America/Bogota'`).
- `lookback_days` (`integer`, default 30, rango 1-365).
- `nightly_enabled` (`boolean`, default `true`).
- `created_at`, `updated_at`.

### 3.3 Tabla `reconciliation_matches`

Registro inmutable y explicable de cada coincidencia:

- `id` (`uuid`, PK).
- `tenant_id` (`uuid`, NOT NULL).
- `bank_transaction_id` (`uuid`, FK `bank_transactions.id`, CASCADE).
- `document_id` (`uuid`, FK `documents.id`, CASCADE).
- `invoice_id` (`uuid`, FK `invoices.id`, SET NULL, opcional).
- `status`: Enum `reconciliation_match_status` (`AUTO_MATCHED`, `NEEDS_REVIEW`, `MANUAL_MATCHED`, `REJECTED`).
- `score` (`numeric(4,3)`, NOT NULL).
- `rule` (`varchar(100)`, NOT NULL): e.g. `amount+date+counterparty`, `amount+invoice_number`, `manual`.
- `evidence` (`jsonb`, NOT NULL): Detalla importe, moneda, delta de días, similitud de contraparte, coincidencia de factura y desglose de score.
- `matched_by` (`uuid`, nullable): Usuario que confirmó el match manual.
- `matched_at` (`timestamp with time zone`, nullable).
- `created_at`, `updated_at`.

#### Restricciones de Unicidad

1. `UNIQUE (tenant_id, bank_transaction_id, document_id)`.
2. **Índice único parcial de transacción activa**:
   `CREATE UNIQUE INDEX reconciliation_matches_tenant_bank_tx_active_idx ON reconciliation_matches (tenant_id, bank_transaction_id) WHERE status IN ('AUTO_MATCHED', 'MANUAL_MATCHED');`
3. **Índice único parcial de documento activo**:
   `CREATE UNIQUE INDEX reconciliation_matches_tenant_doc_active_idx ON reconciliation_matches (tenant_id, document_id) WHERE status IN ('AUTO_MATCHED', 'MANUAL_MATCHED');`
4. Índices para acelerar consultas por tenant/status, documento y transacción.

### 3.4 Tabla `reconciliation_runs`

Historial de ejecuciones de conciliación:

- `id` (`uuid`, PK).
- `tenant_id` (`uuid`, NOT NULL).
- `trigger`: Enum `reconciliation_trigger` (`MANUAL`, `NIGHTLY`).
- `status`: Enum `reconciliation_run_status` (`RUNNING`, `COMPLETED`, `FAILED`).
- `started_at`, `finished_at`.
- Contadores: `processed`, `auto_matched`, `needs_review`, `errors`.
- `error_message` (`text`, nullable).

---

## 4. Cron Nocturno y Worker de BullMQ

### 4.1 Programación por Tenant

`ReconciliationScheduler` se ejecuta en `onModuleInit`:

- Consulta todos los tenants con `nightlyEnabled = true`.
- Invoca `queue.upsertJobScheduler('reconciliation:<tenantId>', { pattern: '0 2 * * *', tz: settings.timezone }, { name: 'nightly', data: { tenantId, trigger: 'NIGHTLY' } })`.
- Al actualizar settings, si `nightlyEnabled` pasa a falso se elimina el scheduler; si cambia la zona horaria, se reprograma con la nueva zona.

### 4.2 Proceso en `ReconciliationWorker`

Al procesar un job en la cola `reconciliation`:

1. Obtiene las conexiones bancarias activas del tenant (`bankConnections`).
2. Itera sobre cada conexión y ejecuta `BankingService.internalSyncConnection` para recuperar movimientos bancarios faltantes del proveedor y actualizar `lastSyncedAt`.
3. Si una conexión bancaria falla (ej. error de credenciales o red del banco), el worker registra el error y **continúa** con las demás conexiones activas.
4. Ejecuta `ReconciliationService.runForTenant` de forma idempotente.
5. Si hubo errores en alguna conexión, relanza una excepción al final para que BullMQ gestione el reintento automático con backoff exponencial.

---

## 5. Endpoints REST (API Gateway)

Prefijo: `/api/v1/finance/reconciliation`

| Método | Ruta                  | Roles Permitidos             | Descripción                                           |
| :----- | :-------------------- | :--------------------------- | :---------------------------------------------------- |
| `GET`  | `/settings`           | Autenticado                  | Obtiene la configuración del tenant actual            |
| `PUT`  | `/settings`           | `TENANT_ADMIN`, `ACCOUNTANT` | Actualiza ventana, umbral, timezone, lookback y cron  |
| `POST` | `/run`                | `TENANT_ADMIN`, `ACCOUNTANT` | Dispara una corrida manual de conciliación            |
| `GET`  | `/review`             | Autenticado                  | Lista candidatos en bandeja `NEEDS_REVIEW`            |
| `POST` | `/review/:id/confirm` | `TENANT_ADMIN`, `ACCOUNTANT` | Confirma match manual (`MANUAL_MATCHED`)              |
| `POST` | `/review/:id/reject`  | `TENANT_ADMIN`, `ACCOUNTANT` | Rechaza propuesta de match (`REJECTED`)               |
| `POST` | `/matches`            | `TENANT_ADMIN`, `ACCOUNTANT` | Crea un match manual arbitrario (valida monto/moneda) |
| `GET`  | `/metrics`            | Autenticado                  | Métricas de rendimiento, tasas y corridas             |

Todos los endpoints extraen `tenantId`, `userId` y `role` directamente del JWT autenticado, garantizando aislamiento estricto entre empresas. Si un recurso no pertenece al tenant del usuario, se devuelve `404 Not Found`.

### 5.1 Métricas de Conciliación

`GET /metrics` calcula:

- `autoMatchRate`: $\frac{\text{autoMatched}}{\text{processed}}$ (o `null` si no hay transacciones procesadas).
- `reviewRate`: $\frac{\text{needsReview}}{\text{processed}}$ (o `null` si no hay datos).
- `hasData`: `false` cuando no existen transacciones o documentos en el período consultado, evitando reportar ceros engañosos a la interfaz de usuario.

---

## 6. Pruebas y Dataset Dorado

### 6.1 Dataset Dorado (`reconciliation-golden-dataset.spec.ts`)

Consta de **35 pares realistas**:

- **30 pares de comprobantes legibles**: Con variaciones de formato, sufijos societarios (`S.A.S.`, `LTDA`, `Inc`, `ESP`, `Pty Ltd`), prefijos de factura (`FAC-`, `FE-`), acrónimos y deltas de fecha realistas.
  - **Resultado**: **100% de auto-conciliación** (superando el requisito de aceptación del 90%).
- **5 casos de control negativos / revisión**: Comprobantes con baja confianza OCR (< 0.85), estado `NEEDS_REVIEW` o discrepancias de contraparte que se canalizan obligatoriamente a revisión humana sin auto-conciliar.

### 6.2 Comandos de Validación

```bash
# Contratos
pnpm --filter @mybusiness/contracts build

# Finance Service (Unitarias, Dataset Dorado, Worker, Scheduler)
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/finance-service build

# Finance Service (Integración Postgres / Constraints)
FINANCE_DATABASE_URL="postgresql://finance_user:...@localhost:5432/finance_db" \
pnpm --filter @mybusiness/finance-service test test/reconciliation.e2e-spec.ts

# API Gateway (Controladores, Servicios, RBAC, Contexto)
pnpm --filter @mybusiness/api-gateway test
pnpm --filter @mybusiness/api-gateway build
```
