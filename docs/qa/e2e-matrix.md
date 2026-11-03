# Matriz E2E Multi-Canal y Aislamiento por Tenant (Issue #54)

Este documento describe la matriz de pruebas End-to-End (E2E) que cubre los **cinco flujos críticos** del sistema MyBusiness, las decisiones de canal (UI web vs API Request), la deuda técnica documentada y la estrategia de verificación de aislamiento estricto multi-tenant (A/B).

---

## 1. Matriz de los Cinco Flujos Críticos

| #     | Flujo Crítico                  | Canal Principal         | Canal Secundario / Integración | Qué Cubre el Test                                                                                                                                                                                                        | Archivo de Prueba                                               |
| :---- | :----------------------------- | :---------------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **1** | **Autenticación y Sesión**     | Web UI (Playwright)     | BFF `/api/session/*`           | Login con credenciales, cookies `httpOnly`, protección CSRF, rotación de refresh tokens y redirecciones protegidas.                                                                                                      | `e2e/session.spec.ts`<br>`e2e/banking-reconciliation.spec.ts`   |
| **2** | **Vinculación Bancaria**       | API Gateway (`request`) | Web UI (Dashboard)             | Inicio de conexión bancaria (`/banking/connect`), intercambio de tokens sandbox (`/banking/exchange`), sincronización forzada (`/sync`) y reflejo de saldos/cuentas en el frontend.                                      | `e2e/banking-reconciliation.spec.ts`                            |
| **3** | **Dashboard de Flujo de Caja** | Web UI (Playwright)     | BFF `/api/cashflow/*`          | Renderizado de tarjetas KPI, gráfico de evolución temporal, desglose de ingresos/gastos por categoría, selectores de período y conmutación de divisas.                                                                   | `e2e/dashboard.spec.ts`<br>`e2e/banking-reconciliation.spec.ts` |
| **4** | **Libro Mayor Financiero**     | Web UI (Playwright)     | BFF `/api/ledger/*`            | Virtualización fluida con 50.000 filas, ordenación por importe/fecha, búsqueda en servidor sin recarga, edición optimista de notas/categorías con rollback y exportación CSV.                                            | `e2e/ledger.spec.ts`<br>`e2e/banking-reconciliation.spec.ts`    |
| **5** | **Conciliación Bancaria**      | API Gateway (`request`) | Web UI (Libro Mayor)           | Disparo del motor de conciliación (`/reconciliation/run`), confirmación de coincidencia (`/review/:id/confirm`), y verificación visual en el libro mayor del estado "Conciliado manual" y enlace a evidencia documental. | `e2e/banking-reconciliation.spec.ts`                            |

---

## 2. Decisión de Arquitectura y Deuda Técnica Documentada

> [!NOTE] Deuda de Producto Documentada
> El portal web actual (`apps/web`) implementa las pantallas de producto correspondientes a los Sprints 1 a 3: Portada/Login, Dashboard (#50) y Libro Mayor (#51). **No existen aún pantallas interactivas de producto para el asistente de vinculación bancaria (Plaid/Belvo widget) ni la bandeja de revisión de conciliación bancaria.**

### Decisión de QA

En estricto cumplimiento con la directriz de **no construir pantallas de producto nuevas en una issue de infraestructura de calidad (QA)**, los flujos sin interfaz web se automatizan de extremo a extremo mediante el cliente de peticiones HTTP de Playwright (`page.request` / `request`) contra el Gateway falso de pruebas (`apps/web/e2e/mock-gateway.mjs`), interactuando contra un mock que replica el contrato perimetral exacto de la API. Los reintentos y repeticiones de peticiones idempotentes devuelven consistentemente código HTTP `201 Created` preservando el mismo `id` y evitando mutaciones no autorizadas.

Inmediatamente después de ejecutar la operación de backend, el test navega a las pantallas de producto existentes (Dashboard y Libro Mayor) y valida visualmente el impacto del cambio:

- Tras vincular una cuenta bancaria y sincronizar transacciones, el Dashboard refleja las nuevas métricas y saldo consolidado.
- Tras ejecutar el motor de conciliación y confirmar un caso de revisión con documento enlazado, la tabla de `/libro-mayor` actualiza dinámicamente la columna `reconciliationStatus` a `Conciliado manual` y muestra el enlace con el identificador de la evidencia documental.

---

## 3. Matriz de Aislamiento por Tenant (A/B)

Se verifica la hermeticidad de datos entre dos tenants concurrentes e independientes: **Tenant A** (identificador `00000000-0000-0000-0000-000000000001`, usuario Ada) y **Tenant B** (identificador `00000000-0000-0000-0000-000000000002`, usuario Bob).

### A. Nivel API Gateway y Microservicios

Verificado en `apps/api-gateway/test/tenant-isolation.spec.ts`:

- **Contexto Criptográfico**: El `tenantId` se extrae exclusivamente del JWT verificado en `req.user`. Cualquier intento de inyectar `tenantId` en body o query params es ignorado o rechazado con error `400 Bad Request` por `ValidationPipe` (`forbidNonWhitelisted: true`).
- **Acceso Cruzado**: Peticiones autenticadas como Tenant B intentando acceder a identificadores de recursos pertenecientes a Tenant A (conexiones bancarias, documentos, revisiones de conciliación, transacciones) reciben invariablemente un `404 Not Found`.
- **Listados y Consultas**: Los endpoints de lectura (`/banking/connections`, `/documents/search`, `/finance/cashflow/summary`, `/finance/ledger`, `/finance/reconciliation/metrics`) retornan únicamente registros pertenecientes al tenant del token.

### B. Nivel Portal Web (Playwright)

Verificado en `apps/web/e2e/banking-reconciliation.spec.ts` (Test 3):

- **Dos contextos de navegador aislados**: Sesión A y Sesión B corren en paralelo en cookies y almacenes separados.
- **Validación en Dashboard**:
  - Tenant A visualiza sus métricas consolidadas (saldo 45.000 €).
  - Tenant B visualiza exclusivamente su flujo de caja (saldo 99.000 €).
- **Validación en Libro Mayor**:
  - Tenant A observa su volumen transaccional (50.000 movimientos).
  - Tenant B observa únicamente sus 2 transacciones exclusivas (`Movimiento Exclusivo Tenant B 001`), sin filtración alguna de los movimientos de Tenant A.
- **Acceso Cruzado en API**: Con el token de sesión de Tenant B, peticiones directas a conexiones de Tenant A retornan `404 Not Found`.
