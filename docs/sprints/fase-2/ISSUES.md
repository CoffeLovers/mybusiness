# Issues — Fase 2 (Sprints 3 y 4)

> Issues creadas en GitHub: **#43–#54** · Epic: **#55**. Este archivo sigue siendo la fuente de verdad del alcance.
> Convención de ID: `SF2-NN`; el número de GitHub se conserva en la tabla de resumen.

## Resumen

| ID     | Título                                       | Labels                      | Owner      | SP  | Sprint | GitHub |
| ------ | -------------------------------------------- | --------------------------- | ---------- | --- | ------ | ------ |
| SF2-01 | Scaffold del portal web en Next.js           | `web`, `frontend`           | Frontend 1 | 5   | 3      | #43    |
| SF2-02 | CI & CD del portal web                       | `web`, `devops`             | Frontend 1 | 5   | 3      | #44    |
| SF2-03 | Sesión web BFF con cookies y CSRF            | `web`, `security`           | Frontend 2 | 8   | 3      | #45    |
| SF2-04 | Open Banking: link, consentimiento y cuentas | `backend`, `security`       | Backend 1  | 8   | 3      | #46    |
| SF2-05 | Webhooks bancarios firmados e idempotentes   | `backend`, `security`       | Backend 1  | 8   | 3      | #47    |
| SF2-06 | BullMQ: colas, workers, backoff y DLQ        | `backend`, `infrastructure` | Backend 2  | 8   | 3      | #48    |
| SF2-07 | OCR y embeddings de facturas                 | `backend`, `database`       | Backend 2  | 8   | 4      | #49    |
| SF2-08 | Dashboard web de flujo de caja y burn rate   | `web`, `frontend`           | Frontend 1 | 8   | 4      | #50    |
| SF2-09 | Libro mayor y conciliación masiva en web     | `web`, `frontend`           | Frontend 2 | 8   | 4      | #51    |
| SF2-10 | Android: enlace bancario y biometría         | `mobile`, `security`        | Frontend 2 | 8   | 4      | #52    |
| SF2-11 | Conciliación automática y cron nocturno      | `backend`, `database`       | Backend 2  | 8   | 4      | #53    |
| SF2-12 | Contratos, E2E multi-canal y carga           | `qa`, `devops`              | Backend 1  | 5   | 4      | #54    |

Todas las issues llevan además los labels `phase-2` y el correspondiente `sprint-3` o `sprint-4`.

---

## SF2-01 — [Web][Setup] Scaffold del portal web en Next.js

**Labels:** `phase-2`, `sprint-3`, `web`, `frontend`
**Owner:** Frontend 1 · **SP:** 5 · **Depende de:** —

### Contexto

El issue #10 excluía el frontend web. El ADR-006 lo incorpora. Esta issue crea la base técnica del portal sin lógica de negocio.

### Alcance

- Crear `apps/web` con Next.js 15 (App Router), React 19, TypeScript estricto y Tailwind.
- Integrarlo al workspace pnpm existente (`apps/*`).
- Design tokens: colores semánticos financieros (ingreso, egreso, neutral, alerta), tipografía, espaciado y radios; modo claro/oscuro.
- Shell autenticado: layout, navegación lateral, breadcrumbs, estados de carga, error boundary y 404.
- Route groups `(auth)` y `(app)`; placeholder de login sin lógica.
- Página `/healthz` para smoke tests de despliegue.

### Fuera de alcance

- Autenticación real (SF2-03).
- Consumo de datos del gateway (SF2-08).
- Componentes de tablas densas (SF2-09).

### Criterios de aceptación

- [ ] `pnpm --filter @mybusiness/web build` finaliza sin errores ni warnings de tipos.
- [ ] `apps/web` aparece en `pnpm-workspace.yaml` sin cambios manuales adicionales.
- [ ] El shell responde en rutas `/`, `/login` y `/healthz`.
- [ ] Tokens de color con contraste ≥ 4.5:1 en texto normal y ≥ 3:1 en texto grande, en ambos modos.
- [ ] `prefers-reduced-motion` respetado en animaciones.
- [ ] No se usa `localStorage` ni `sessionStorage` para secretos.
- [ ] Test de humo con Playwright que carga `/` y `/login`.

### Validación

```bash
pnpm --filter @mybusiness/web lint
pnpm --filter @mybusiness/web typecheck
pnpm --filter @mybusiness/web test
pnpm --filter @mybusiness/web build
```

---

## SF2-02 — [Web][DevOps] CI & CD del portal web

**Labels:** `phase-2`, `sprint-3`, `web`, `devops`, `security`
**Owner:** Frontend 1 · **SP:** 5 · **Depende de:** SF2-01 (CI mínimo incluido en ese PR)

### Contexto

El repositorio ya tiene `ci.yml` y `security.yml` para backend y paquetes. El portal web necesita su propio pipeline de integración y despliegue, con los mismos estándares y sin ralentizar el pipeline existente. Para evitar un bloqueo de bootstrap, el PR de SF2-01 incorpora un `web-ci.yml` mínimo; esta issue lo completa.

### Alcance — Integración continua

- Workflow `.github/workflows/web-ci.yml` disparado por cambios en `apps/web/**`, `packages/contracts/**` y `packages/common/**`.
- Pasos: `pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, tests unitarios con cobertura, `build`, E2E con Playwright y reporte de artefactos.
- Extender `lint` y `eslint.config.js` a `**/*.{ts,tsx}` para cubrir el portal, hoy limitado a TypeScript de backend.
- Cache de pnpm y de `.next/cache`.
- Escaneo de la imagen con Trivy y envío de cobertura a SonarCloud.
- Checks requeridos en `develop` y `main`.

### Alcance — Despliegue continuo

- Workflow `.github/workflows/web-cd.yml`: al mergear a `develop`, construir imagen Docker `standalone` multi-stage, publicarla en GHCR con tag por SHA y desplegar en staging.
- Al mergear a `main`, desplegar en producción con aprobación manual mediante GitHub Environment.
- Smoke test post-despliegue contra `/healthz` y `/login`; rollback automático a la imagen anterior si falla.
- Preview por PR: construir la imagen y ejecutar E2E contra el build; el despliegue a staging ocurre sólo al mergear.
- Secretos exclusivamente en GitHub Secrets; prohibido imprimirlos en logs.

### Criterios de aceptación

- [ ] Un PR que rompe lint, tipos, tests o build queda bloqueado por `web-ci`.
- [ ] La cobertura del portal se publica en SonarCloud.
- [ ] `web-cd` publica imagen en GHCR con tag inmutable por SHA.
- [ ] El despliegue a staging es automático desde `develop` y verificable por URL.
- [ ] El despliegue a producción exige aprobación manual.
- [ ] El rollback funciona y está documentado en `docs/runbook-web-deploy.md`.
- [ ] El pipeline completa en < 10 minutos (p50).
- [ ] No hay secretos en logs ni en artefactos.

### Validación

```bash
pnpm exec prettier --check .github/workflows/web-ci.yml .github/workflows/web-cd.yml
gh workflow run web-ci.yml
gh run watch
```

---

## SF2-03 — [Web][Security] Sesión web BFF con cookies y CSRF

**Labels:** `phase-2`, `sprint-3`, `web`, `security`
**Owner:** Frontend 2 · **SP:** 8 · **Depende de:** SF2-01, #5, #6

### Contexto

El navegador no debe recibir tokens de acceso ni de refresco. El portal actúa como BFF: mantiene la sesión en el servidor y expone sólo cookies `HttpOnly`.

### Alcance

- Route Handlers `/api/session/login`, `/api/session/refresh`, `/api/session/logout`, `/api/session/me`.
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; access token de vida corta y refresh con rotación.
- CSRF double-submit en mutaciones y verificación de `Origin`/`Referer`.
- Timeout por inactividad (30 min) y límite absoluto (12 h).
- Revocación por dispositivo y cierre de sesión global.
- Reautenticación obligatoria para operaciones sensibles.
- Propagación de `tenantId`, `userId` y `role` al gateway; sin fallback por cabecera.

### Criterios de aceptación

- [ ] Tras el login, el navegador no contiene tokens en `localStorage`, `sessionStorage` ni cookies legibles por JS.
- [ ] Un POST sin token CSRF válido devuelve 403.
- [ ] Un `Origin` no permitido devuelve 403.
- [ ] El refresh rota el token y rechaza la reutilización del anterior.
- [ ] Logout revoca el refresh en `auth-service` y limpia cookies.
- [ ] La sesión inactiva expira a los 30 minutos.
- [ ] Tests unitarios y E2E cubren login, refresh, CSRF, revocación y expiración.

### Validación

```bash
pnpm --filter @mybusiness/web test
pnpm --filter @mybusiness/web test:e2e
```

---

## SF2-04 — [Banking] Open Banking: link, consentimiento y cuentas

**Labels:** `phase-2`, `sprint-3`, `backend`, `security`, `database`
**Owner:** Backend 1 · **SP:** 8 · **Depende de:** #13

### Contexto

`finance-service` necesita una capa de proveedores intercambiables para Belvo y Plaid. El consentimiento y los tokens deben cifrarse y auditarse.

### Alcance

- Puerto `BankingProvider` con adaptadores `BelvoProvider` y `PlaidProvider`.
- Endpoints en el gateway: `POST /banking/links`, `GET /banking/links/:id`, `POST /banking/links/:id/sync`, `GET /banking/accounts`.
- Persistencia de `BankLink` y `BankAccount` con `tenantId` obligatorio.
- Cifrado de tokens de proveedor con AES-256-GCM y clave fuera de la base de datos.
- Registro de consentimiento (fecha, alcance, expiración) y evento de auditoría por vinculación y sincronización.
- Sincronización idempotente por `(tenantId, providerAccountId, externalId)`.
- Manejo de errores del proveedor con códigos estables y sin filtrar credenciales.

### Criterios de aceptación

- [ ] Se vincula una cuenta sandbox de Belvo y una de Plaid en entorno de pruebas.
- [ ] Los tokens se guardan cifrados; una consulta directa a la base no revela el valor.
- [ ] Ningún endpoint devuelve tokens del proveedor.
- [ ] Un usuario del tenant B no puede leer ni sincronizar cuentas del tenant A (403).
- [ ] La sincronización repetida no duplica cuentas ni transacciones.
- [ ] Cada vinculación genera un registro de auditoría.
- [ ] Tests con proveedores stubbeados y contrato de errores.

### Validación

```bash
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/api-gateway test:e2e
```

---

## SF2-05 — [Banking] Webhooks bancarios firmados e idempotentes

**Labels:** `phase-2`, `sprint-3`, `backend`, `security`
**Owner:** Backend 1 · **SP:** 8 · **Depende de:** SF2-04, #15

### Contexto

Los webhooks son la vía principal de actualización. Deben fallar cerrado ante firma inválida y resistir duplicados y desorden.

### Alcance

- `POST /banking/webhooks/:provider` con body crudo.
- Verificación de firma por proveedor; sin secreto configurado, rechazo en producción.
- Dedupe por `providerEventId`; duplicados responden 200 sin reprocesar.
- Encolar en BullMQ y responder rápido; el procesamiento corre fuera del request.
- Proyecciones sólo avanzan si el evento es más reciente (`occurredAt`).
- Estado `RECEIVED`, `PROCESSED`, `IGNORED`, `FAILED`; reintentos y replay manual.
- `lastSyncedAt` por cuenta, expuesto al gateway.

### Criterios de aceptación

- [x] Firma inválida → 401 y evento no encolado.
- [x] Duplicado → 200 y sin reprocesamiento (contador de auditoría sin cambios).
- [x] Evento fuera de orden no retrocede el estado de la cuenta.
- [x] Fallo de procesamiento reintenta con backoff y termina en `FAILED` visible.
- [x] Replay manual por ID funciona y queda auditado.
- [x] Tests de firma, dedupe, orden y reintentos.

> **Deuda heredada de SF2-04:** Belvo sigue fail-closed (501/401). El flujo
> completo de firma, idempotencia, BullMQ, orden y replay se implementó y
> validó con Plaid. Ver [`docs/banking-webhooks.md`](../../banking-webhooks.md).

### Validación

```bash
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/api-gateway test:e2e
```

---

## SF2-06 — [Async] BullMQ: colas, workers, backoff y DLQ

**Labels:** `phase-2`, `sprint-3`, `backend`, `infrastructure`
**Owner:** Backend 2 · **SP:** 8 · **Depende de:** #2

### Contexto

ADR-002 define Redis como broker y BullMQ para trabajo durable. Esta issue implementa la infraestructura común, no jobs de negocio concretos.

### Alcance

- Módulo de colas con `getBullMQConnectionOptions`.
- Colas: `banking-sync`, `ocr`, `reconciliation`, `notifications`.
- Workers con concurrencia configurable, reintentos exponenciales, `attempts: 5` y DLQ por cola.
- Idempotencia por `jobId` determinista.
- Apagado ordenado sin pérdida de jobs en curso.
- Métricas: jobs activos, completados, fallidos, en DLQ.
- Variables de entorno documentadas.

### Criterios de aceptación

- [ ] Un worker que falla reintenta con backoff y termina en DLQ.
- [ ] Reiniciar el proceso no pierde jobs encolados.
- [ ] Un `jobId` repetido no crea un segundo job.
- [ ] El apagado espera los jobs en curso hasta un timeout configurado.
- [ ] Existen tests de reintento, DLQ e idempotencia.
- [ ] `.env.example` documenta todas las variables nuevas.

### Validación

```bash
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/agent-service test
```

---

## SF2-07 — [Agent] OCR y embeddings de facturas

**Labels:** `phase-2`, `sprint-4`, `backend`, `database`
**Owner:** Backend 2 · **SP:** 8 · **Depende de:** SF2-06, #14

### Contexto

Las facturas y comprobantes llegan como PDF o imagen desde web o Android. Deben convertirse en datos estructurados, almacenarse de forma segura e indexarse para búsqueda semántica.

### Alcance

- `POST /documents` multipart con límite de tamaño y tipos permitidos (`application/pdf`, `image/jpeg`, `image/png`).
- `DocumentStorage` sobre S3-compatible (MinIO en local); nunca se guardan binarios en PostgreSQL.
- Puerto `OcrProvider` con adaptador Mindee; umbral de confianza configurable (0.85).
- Estados `PENDING`, `PROCESSING`, `EXTRACTED`, `NEEDS_REVIEW`, `FAILED`.
- Normalización: proveedor, identificador fiscal, fecha, moneda, `totalMinor` y líneas.
- Indexación de embeddings 1536d en `agent_db` vía RPC a `agent-service`, con índice HNSW.
- `GET /documents/search?q=` con aislamiento por tenant.

### Criterios de aceptación

- [ ] Una factura PDF de fixture se extrae con proveedor, fecha, moneda y total correctos.
- [ ] Una imagen con confianza < 0.85 pasa a `NEEDS_REVIEW` y no se concilia automáticamente.
- [ ] El archivo original no se sirve sin autorización del tenant.
- [ ] La búsqueda semántica devuelve sólo documentos del tenant.
- [ ] Los reintentos de OCR no duplican documentos.
- [ ] Tests con fixtures y proveedor stubbeado; cobertura ≥ 80 %.

### Validación

```bash
pnpm --filter @mybusiness/agent-service test
pnpm --filter @mybusiness/finance-service test
```

---

## SF2-08 — [Web] Dashboard de flujo de caja y burn rate

**Labels:** `phase-2`, `sprint-4`, `web`, `frontend`
**Owner:** Frontend 1 · **SP:** 8 · **Depende de:** SF2-01, SF2-03, #13

### Contexto

Primera pantalla analítica del portal. Todos los importes llegan calculados por el backend en unidad mínima; el cliente sólo formatea.

### Alcance

- Tarjetas: saldo consolidado, ingresos, egresos, burn rate y runway.
- Gráfico de flujo de caja (ECharts) y desglose por categoría.
- Selector de período y comparación con el período anterior.
- Formato monetario desde `*Minor` y moneda del tenant.
- Estados de carga, vacío y error con reintento.
- Responsive de 1280 px a 1920 px; navegación por teclado.

### Criterios de aceptación

- [ ] Los datos provienen exclusivamente del gateway; no hay cálculos monetarios en el cliente.
- [ ] El cambio de período actualiza todas las tarjetas y gráficos de forma consistente.
- [ ] Un tenant sin datos muestra empty state, no cifras en cero engañosas.
- [ ] Error del gateway muestra mensaje accionable y botón de reintento.
- [ ] p95 de carga < 2 s en staging con dataset de 50.000 transacciones.
- [ ] axe sin violaciones críticas; navegación completa por teclado.

### Validación

```bash
pnpm --filter @mybusiness/web test
pnpm --filter @mybusiness/web test:e2e
```

---

## SF2-09 — [Web] Libro mayor y conciliación masiva

**Labels:** `phase-2`, `sprint-4`, `web`, `frontend`
**Owner:** Frontend 2 · **SP:** 8 · **Depende de:** SF2-08, SF2-11

### Contexto

La tabla densa es la razón principal del portal web. Debe soportar decenas de miles de filas sin bloquear la interfaz y permitir operaciones masivas auditadas.

### Alcance

- TanStack Table con virtualización y paginación, ordenamiento y filtros server-side.
- Columnas: fecha, descripción, contraparte, categoría, monto, moneda, estado de conciliación, evidencia.
- Vistas guardadas por usuario y exportación CSV.
- Edición en línea limitada a categoría y notas, con actualización optimista y rollback.
- Selección múltiple y categorización masiva (máximo 500 filas) con confirmación explícita.
- Navegación por teclado y anuncios ARIA.

### Criterios de aceptación

- [ ] 50.000 filas se renderizan sin bloquear la UI (virtualización verificada).
- [ ] Ordenar y filtrar no recarga la página; la query se ejecuta en el servidor.
- [ ] Una edición fallida revierte el valor y muestra el error.
- [ ] Toda edición y acción masiva genera auditoría con usuario, valor anterior y nuevo.
- [ ] La exportación respeta filtros activos y el aislamiento por tenant.
- [ ] axe sin violaciones críticas y foco visible en toda la tabla.

### Validación

```bash
pnpm --filter @mybusiness/web test
pnpm --filter @mybusiness/web test:e2e
```

---

## SF2-10 — [Mobile] Android: enlace bancario y biometría

**Labels:** `phase-2`, `sprint-4`, `mobile`, `security`
**Owner:** Frontend 2 · **SP:** 8 · **Depende de:** SF2-04, SF2-05

### Contexto

La app Android ya existe (`apps/mobile-android`). Debe incorporar el enlace bancario y proteger las acciones sensibles con biometría.

### Alcance

- Flujo de vinculación con Custom Tabs y deep link de retorno.
- Pantalla de estado de sincronización con `lastSyncedAt`, refresco manual y errores.
- `BiometricPrompt` con fallback a credencial de dispositivo para capturar, reembolsar o aprobar.
- Tokens en almacenamiento cifrado del Keystore; prohibido en logs.
- Manejo de expiración de sesión y revocación.

### Criterios de aceptación

- [ ] Se vincula una cuenta sandbox desde la app y se refleja en web.
- [ ] El estado de sincronización muestra la última fecha real del backend.
- [ ] Una acción sensible sin biometría válida no se ejecuta.
- [ ] El fallback a credencial de dispositivo funciona en emulador configurado.
- [ ] Los logs no contienen tokens ni datos personales.
- [ ] Tests unitarios del ViewModel y prueba manual documentada en dispositivo.

### Validación

```bash
cd apps/mobile-android && ./gradlew :app:testDebugUnitTest
cd apps/mobile-android && ./gradlew :app:assembleDebug
```

---

## SF2-11 — [Banking] Conciliación automática y cron nocturno

**Labels:** `phase-2`, `sprint-4`, `backend`, `database`
**Owner:** Backend 2 · **SP:** 8 · **Depende de:** SF2-04, SF2-05, SF2-06, SF2-07

### Contexto

El objetivo de producto es superar el 90 % de conciliación automática en transacciones con comprobante. La lógica debe ser determinista y explicable.

### Alcance

- Motor de matching por monto exacto, ventana de fechas configurable, contraparte difusa y número de factura.
- Puntuación de confianza y umbral de auto-conciliación configurable por tenant.
- Bandeja de revisión para casos dudosos con evidencia lado a lado.
- Registro de evidencia: transacción, documento, regla aplicada y puntuación.
- Cron nocturno por zona horaria del tenant para recuperar movimientos faltantes.
- Métricas: tasa de match automático, tasa de revisión y errores.

### Criterios de aceptación

- [ ] Sobre el dataset dorado con comprobantes legibles, el match automático supera el 90 %.
- [ ] Un match manual deja evidencia y auditoría; uno automático también.
- [ ] No se concilia dos veces la misma transacción ni el mismo documento.
- [ ] El cron recupera movimientos perdidos y actualiza `lastSyncedAt`.
- [ ] Un caso dudoso nunca se auto-concilia por debajo del umbral.
- [ ] Reporte de métricas disponible para web y Android.

### Validación

```bash
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/finance-service test:e2e
```

---

## SF2-12 — [QA] Contratos, E2E multi-canal y carga

**Labels:** `phase-2`, `sprint-4`, `qa`, `devops`
**Owner:** Backend 1 · **SP:** 5 · **Depende de:** SF2-01 … SF2-11

### Contexto

La fase introduce un segundo cliente. La paridad de contratos y el aislamiento por tenant deben verificarse automáticamente.

### Alcance

- OpenAPI generado desde el gateway y versionado en el repositorio.
- Verificación de drift en CI: si el contrato cambia sin actualizar clientes, el pipeline falla.
- Modelos Kotlin generados o verificados contra OpenAPI.
- E2E Playwright: login → vincular cuenta → dashboard → libro mayor → conciliación.
- E2E de aislamiento: tenant A no ve datos del tenant B en web ni en API.
- Prueba de carga con k6: ingesta de 50.000 transacciones en 30 minutos.
- Reporte de resultados adjunto al PR.

### Criterios de aceptación

- [ ] `web-ci` falla si OpenAPI y los tipos del cliente divergen.
- [ ] Los E2E cubren los cinco flujos críticos en verde.
- [ ] El test de aislamiento A/B pasa en todos los endpoints nuevos.
- [ ] La carga de 50.000 transacciones no pierde eventos y mantiene p95 < 5 s en ingesta.
- [ ] El reporte de carga y los artefactos quedan adjuntos.

### Validación

```bash
pnpm test:e2e
k6 run tests/load/ingest-50k.js
```

---

## Anexo — Creación en GitHub

Los labels y las issues se crearon el 2026-10-30 (ver tabla de resumen). Los comandos siguientes quedan como referencia reproducible.

```bash
gh label create phase-2 --description "Fase 2: Canales y datos" --color 5319E7
gh label create sprint-3 --description "Sprint 3 (2026-11-02 a 2026-11-13)" --color 0E8A16
gh label create sprint-4 --description "Sprint 4 (2026-11-16 a 2026-11-27)" --color 1D76DB
gh label create web --description "Portal web Next.js" --color 2D9CDB
gh label create qa --description "Pruebas, contratos y calidad" --color FBCA04
```

Cada issue se crea con `gh issue create --title "<título>" --body-file <archivo> --label ...`. El cuerpo debe ser la sección correspondiente de este documento, sin el encabezado de resumen.
