# Issues — Fase 5 (Sprint 9)

> Las issues se crearán en GitLab a partir de este documento; **este archivo es la fuente de verdad del alcance**.
> Convención de ID: `SF5-NN`; la columna `GitLab` se completará cuando se creen formalmente.
> Ventana: **Sprint 9** 2027-01-25 → 2027-02-05 · **Capacidad:** 42 SP.
> Epic: **#77** (`[EPIC] Fase 5: Pruebas integrales, seguridad y cumplimiento`) · Issues: **#78–#84**

## Resumen

| ID     | Título                                                                                       | Labels                                                           | Owner                         | SP  | Sprint | GitLab |
| ------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- | --- | ------ | ------ |
| SF5-01 | [QA] Suite de pruebas integrales E2E cross-service (Open Banking, facturas y libro mayor)    | `qa`, `backend`, `finance`, `phase-5`, `sprint-9`                | Juancho (@JuanchR4)           | 8   | 9      | #78    |
| SF5-02 | [Security] Hardening, auditoría de seguridad y pruebas de penetración                        | `security`, `backend`, `web`, `phase-5`, `sprint-9`              | Farid (@farid15berrio10-a11y) | 8   | 9      | #79    |
| SF5-03 | [Perf] Prueba de carga masiva y estrés de concurrencia (50k transacciones & SSE)             | `qa`, `performance`, `devops`, `phase-5`, `sprint-9`             | Juancho (@JuanchR4)           | 5   | 9      | #80    |
| SF5-04 | [Compliance] Retención, purga segura y portabilidad de datos (GDPR / Habeas Data)            | `compliance`, `backend`, `audit`, `phase-5`, `sprint-9`          | Farid (@farid15berrio10-a11y) | 5   | 9      | #81    |
| SF5-05 | [Infra] Decisión y arquitectura de despliegue en producción (ADR-009)                        | `devops`, `architecture`, `documentation`, `phase-5`, `sprint-9` | Farid (@farid15berrio10-a11y) | 5   | 9      | #82    |
| SF5-06 | [QA] Certificación de cobros PayPal y evaluación del agente con set dorado ampliado          | `qa`, `agent`, `payments`, `phase-5`, `sprint-9`                 | Juancho (@JuanchR4)           | 5   | 9      | #83    |
| SF5-07 | [DevOps] Pipeline de seguridad integral y dependencias (SAST/DAST y escaneo de contenedores) | `ci-cd`, `devops`, `security`, `phase-5`, `sprint-9`             | Farid (@farid15berrio10-a11y) | 6   | 9      | #84    |

Todas las issues llevan además los labels `phase-5` y `sprint-9`.

---

## Fichas

## SF5-01 — [QA] Suite de pruebas integrales E2E cross-service (Open Banking, facturas y libro mayor)

**Labels:** `phase-5`, `sprint-9`, `qa`, `backend`, `finance`  
**Owner:** Juancho (@JuanchR4) · **SP:** 8 · **Depende de:** #26, #22, #24, #64

### Contexto

Durante las Fases 2, 3 y 4 se desarrollaron módulos aislados: sincronización bancaria, OCR de comprobantes, motor de conciliación y visualización del libro mayor. Es indispensable contar con una suite de pruebas unificada que valide el flujo convergente de una empresa real: ingestión de extractos bancarios, procesamiento asíncrono de facturas PDF, conciliación automática multi-moneda por algoritmos probabilísticos y actualización atómica del balance en el libro mayor.

### Alcance

- Arnés automatizado en Jest/Playwright que simula la jornada completa de un tenant multi-empresa.
- Flujo 1: Conexión bancaria Plaid Sandbox → webhook `SYNC_UPDATES_AVAILABLE` → consumo por BullMQ → almacenamiento idempotente en `bank_transactions`.
- Flujo 2: Carga multipart de factura PDF (`/api/v1/documents`) → extracción OCR (Mindee stub) → normalización a unidades menores (`amountMinor`) → indexación semántica en pgvector.
- Flujo 3: Ejecución del motor de conciliación cruzando transacciones bancarias contra facturas pendientes con umbral de coincidencia $\ge 90\%$.
- Flujo 4: Verificación de reflejo en `/api/v1/finance/ledger` y emisión de evento inmutable a `audit-service`.
- Verificación estricta de aislamiento A/B: las transacciones del Tenant A no son visibles ni afectan los balances del Tenant B bajo ninguna circunstancia.

### Fuera de alcance

- Interfaz gráfica de usuario web/móvil (cubierto a nivel API y contratos).
- Pruebas de carga volumétrica masiva (reservadas para SF5-03).

### Criterios de aceptación

- [ ] La suite se ejecuta de punta a punta en un entorno de pruebas con bases de datos limpias.
- [ ] La conciliación automática empareja con éxito al menos el 95% de los pares factura-movimiento bancario con diferencias de fecha $\le 3$ días.
- [ ] Cualquier fallo durante el proceso de conciliación revierte la transacción atómica sin dejar estados corruptos.
- [ ] Los eventos de auditoría se registran con `tenantId`, `userId`, `traceId` y hash de integridad.
- [ ] 0 fugas de datos entre tenants en ejecuciones paralelas.

### Validación

```bash
pnpm --filter @mybusiness/finance-service test:e2e:integration
pnpm --filter @mybusiness/contracts test
```

---

## SF5-02 — [Security] Hardening, auditoría de seguridad y pruebas de penetración

**Labels:** `phase-5`, `sprint-9`, `security`, `backend`, `web`  
**Owner:** Farid (@farid15berrio10-a11y) · **SP:** 8 · **Depende de:** #56, #57, #6, #7

### Contexto

MyBusiness maneja transacciones monetarias y credenciales bancarias. Antes de producción es obligatorio certificar que el API Gateway, el BFF web y los microservicios internos resisten intentos deliberados de vulneración, evasión de controles multi-tenant, inyecciones de código y ataques de repetición o falsificación.

### Alcance

- Batería de pruebas de penetración y fuzzing sobre el API Gateway y BFF de Next.js.
- Verificación anti-bypass de tenant: intento de inyección de encabezados `x-tenant-id`, manipulación de claims JWT, acceso a endpoints RPC internos y ataques IDOR en `/api/v1/finance/*` y `/api/v1/documents/*`.
- Auditoría de autenticación y sesiones: resistencia a fijación de sesión, pruebas de entropía en cookies selladas AES-256-GCM, validación estricta de origen y HMAC en tokens CSRF.
- Salvaguarda crítica de RBAC: verificación exhaustiva de imposibilidad de degradar o eliminar al último administrador de un tenant (`cannot_remove_last_admin`).
- Hardening de cabeceras HTTP: configuración estricta de Content Security Policy (CSP), HSTS con `preload`, `X-Content-Type-Options: nosniff` y `X-Frame-Options: DENY`.
- Rate limiting bajo ataque: validación del script Lua de Redis ante ráfagas coordinadas y degradación segura al fallback en memoria (LRU máx. 5000) sin permitir bypass de cuota.

### Fuera de alcance

- Pruebas de ingeniería social o phishing a usuarios reales.
- Auditoría física de centros de datos.

### Criterios de aceptación

- [ ] 0 vulnerabilidades de severidad Alta o Crítica en el informe de seguridad.
- [ ] El 100% de los intentos de acceso cruzado entre tenants recibe código HTTP 403 Forbidden y genera alerta de auditoría `security.threat.detected`.
- [ ] La eliminación del último admin es rechazada de forma determinista con error 400 y mensaje semántico.
- [ ] Las cookies de sesión y CSRF no son accesibles desde scripts del cliente (`HttpOnly`, `SameSite=Lax`).
- [ ] Las cabeceras de seguridad obtienen calificación A+ en analizadores de seguridad HTTP.

### Validación

```bash
pnpm --filter @mybusiness/api-gateway test:security
pnpm --filter @mybusiness/web test:security
pnpm run audit:security-rules
```

---

## SF5-03 — [Perf] Prueba de carga masiva y estrés de concurrencia (50k transacciones & SSE)

**Labels:** `phase-5`, `sprint-9`, `qa`, `performance`, `devops`  
**Owner:** Juancho (@JuanchR4) · **SP:** 5 · **Depende de:** #21, #54, #65

### Contexto

El sistema debe garantizar alta disponibilidad durante picos operativos de cierre fiscal y conciliaciones masivas. Se requiere validar que la arquitectura de colas BullMQ, la base de datos PostgreSQL 16 y el servidor BFF de Next.js operan de forma estable bajo una carga continua de 50.000 transacciones y 500 conexiones SSE activas concurrentes.

### Alcance

- Escenarios de carga k6 ejecutados contra el entorno de integración o staging.
- Escenario 1 (BullMQ & Postgres): Ingestión por lotes de 50.000 transacciones en la cola `banking-sync` con 10 workers concurrentes.
- Escenario 2 (BFF & SSE): Mantenimiento de 500 conexiones de streaming de eventos abiertas simultáneamente durante 10 minutos, con emisión periódica de tokens y cancelaciones aleatorias.
- Medición de saturación de recursos: uso de CPU, percentiles de latencia de base de datos (p95 y p99), uso de memoria en Node.js y recuento de fugas en el event loop.
- Verificación del comportamiento ante fallos: reinicio controlado de una instancia de Redis y verificación de reconexión sin pérdida de trabajos encolados.

### Fuera de alcance

- Pruebas de estrés distribuidas en múltiples zonas geográficas globales.
- Escalado dinámico en Kubernetes (Fase 6).

### Criterios de aceptación

- [ ] Las 50.000 transacciones se procesan en un tiempo total $< 5$ minutos sin errores ni registros huérfanos.
- [ ] El percentil p95 de respuesta del API Gateway se mantiene $< 250$ ms durante la prueba de carga.
- [ ] Las 500 conexiones SSE no provocan fugas de memoria (`heapUsed` estable) ni cierres anómalos del servidor Next.js.
- [ ] Las colas DLQ (`*-dlq`) no reciben trabajos válidos por desbordamiento de timeout.
- [ ] Informe de rendimiento documentado en `docs/performance/load-test-50k-report.md`.

### Validación

```bash
node scripts/verify-load-54.mjs
pnpm --filter @mybusiness/api-gateway test:load
```

---

## SF5-04 — [Compliance] Retención, purga segura y portabilidad de datos (GDPR / Habeas Data)

**Labels:** `phase-5`, `sprint-9`, `compliance`, `backend`, `audit`  
**Owner:** Farid (@farid15berrio10-a11y) · **SP:** 5 · **Depende de:** #15, #58

### Contexto

Las leyes de protección de datos (GDPR, Habeas Data) exigen que las empresas permitan a sus usuarios descargar toda su información y ejercer el derecho al olvido (anonimización/borrado). Al mismo tiempo, las normas tributarias y contables exigen que los libros contables y las facturas sean inmutables y no puedan eliminarse. Es necesario implementar un mecanismo de purga y anonimización que reconcilie ambos mandatos legales.

### Alcance

- Endpoint administrativo y tarea programada de retención para `audit-service`: archivado de eventos mayores a 1 año en almacenamiento comprimido y purga controlada de `audit_dead_letters`.
- Flujo de portabilidad de datos: endpoint `POST /api/v1/tenant/export` que emite un archivo ZIP cifrado con los extractos, facturas y metadatos en formato JSON y CSV RFC 4180.
- Flujo de anonimización (Derecho al Olvido): pseudonimización criptográfica irreversible de datos personales de usuarios (nombre, correo electrónico, teléfono, IP de auditoría) mediante hashing SHA-256 salteado con clave efímera.
- Preservación contable: los importes, fechas de transacción, referencias contables y asientos del libro mayor se mantienen intactos, desvinculando la identidad del titular.

### Fuera de alcance

- Firma digital de certificados fiscales de destrucción de datos (dependiente de legislación por país en Fase 6).

### Criterios de aceptación

- [ ] La purga de auditoría solo elimina registros fuera del período de retención legal y emite un log de control con el número de filas purgadas y checksum.
- [ ] El paquete de exportación de datos incluye todos los registros del tenant solicitante y ningún dato de otros tenants.
- [ ] Tras la anonimización de un usuario, sus datos no pueden ser reidentificados pero el libro mayor cuadra exactamente con los mismos saldos históricos.
- [ ] Todas las operaciones de exportación y anonimización quedan asentadas en `audit_events`.

### Validación

```bash
pnpm --filter @mybusiness/audit-service test
pnpm --filter @mybusiness/finance-service test:compliance
```

---

## SF5-05 — [Infra] Decisión y arquitectura de despliegue en producción (ADR-009)

**Labels:** `phase-5`, `sprint-9`, `devops`, `architecture`, `documentation`  
**Owner:** Farid (@farid15berrio10-a11y) · **SP:** 5 · **Depende de:** #71, #76

### Contexto

Según la sección §8.3 de `PLAN-INTEGRAL-DESARROLLO.md`, la decisión sobre el destino definitivo de despliegue en producción (Kubernetes vs Contenedores Gestionados como ECS o Nomad) debe formalizarse al inicio de la Fase 5. Es necesario redactar el ADR-009, definir los manifiestos base de infraestructura como código (IaC), establecer la gestión segura de secretos y estandarizar los healthchecks de liveness y readiness para todos los microservicios.

### Alcance

- Redacción del documento formal `docs/adr/009-production-deployment-target.md` con análisis comparativo de costes, complejidad operativa, soberanía de datos y criterios de reversibilidad.
- Definición de la estrategia de secretos: uso de gestor de secretos externo (Vault o AWS/GCP Secrets Manager) desacoplado del código y de las imágenes Docker.
- Especificación de healthchecks estandarizados: `/healthz/liveness` (proceso vivo) y `/healthz/readiness` (conexión a Postgres/Redis verificada) en todos los servicios (`api-gateway`, `auth-service`, `finance-service`, `agent-service`, `audit-service`, `apps/web`).
- Manifiestos base o compose de producción con límites estrictos de CPU y memoria, usuarios sin privilegios root y configuraciones de red aisladas.
- Estrategia de migraciones de base de datos sin downtime (`zero-downtime migrations`) mediante pre-deploy jobs.

### Fuera de alcance

- Aprovisionamiento real de la infraestructura en la nube pública (Fase 6).
- Configuración de pipelines multizona activos-activos.

### Criterios de aceptación

- [ ] ADR-009 redactado, revisado y con consenso unánime de los desarrolladores principales.
- [ ] Todos los microservicios y el portal web responden a los probes de liveness y readiness con códigos 200 y 503 adecuados.
- [ ] Los contenedores de producción no ejecutan procesos como root (`USER node` o usuario no privilegiado).
- [ ] El procedimiento de despliegue y rollback está documentado en un runbook operativo preliminar.

### Validación

```bash
pnpm run check:health-endpoints
pnpm exec prettier --check docs/adr/009-production-deployment-target.md
```

---

## SF5-06 — [QA] Certificación de cobros PayPal y evaluación del agente con set dorado ampliado

**Labels:** `phase-5`, `sprint-9`, `qa`, `agent`, `payments`  
**Owner:** Juancho (@JuanchR4) · **SP:** 5 · **Depende de:** #36, #37, #38, #34, #62

### Contexto

Los flujos de pagos (PayPal) y las recomendaciones del asistente de IA manejan dinero e información financiera sensible. Cualquier error en el redondeo de comisiones de cobro o cualquier alucinación en el cálculo de flujo de caja puede ocasionar pérdidas financieras al cliente. Es crítico certificar el flujo completo de cobro y someter al agente a una evaluación con un set dorado riguroso de al menos 50 escenarios financieros reales.

### Alcance

- Certificación E2E de PayPal: creación de órdenes, enlaces de cobro con aprobación humana (HITL), recepción de webhooks firmados por PayPal (`PAYMENT.CAPTURE.COMPLETED`), conciliación automática de la comisión retenida e importes en moneda menor (`amountMinor`).
- Ampliación del set dorado de evaluación del agente (`scripts/agent/golden-dataset.json`) de 30 a 50 preguntas complejas (cálculo de runway, burn rate, márgenes por categoría y detección de transacciones anómalas).
- Suite automatizada de evaluación semántica y matemática: verificación de que el LLM nunca realiza cálculos aritméticos en el prompt (usa exclusivamente herramientas MCP auditadas) y que las respuestas citan siempre la fuente de datos.
- Medición de métricas de calidad: tasa de no-alucinación $\ge 98\%$, precisión en citas de transacciones $= 100\%$ y latencia p95 bajo umbral.

### Fuera de alcance

- Cuentas de producción reales de PayPal con dinero real.
- Integración de nuevos modelos de lenguaje LLM.

### Criterios de aceptación

- [ ] El ciclo de cobro de PayPal se ejecuta de forma idempotente: el reenvío del mismo webhook no duplica la transacción ni el asiento contable.
- [ ] La comisión de PayPal se calcula y desglosa en la unidad menor correspondiente a la divisa de cobro.
- [ ] El set dorado de 50 preguntas alcanza al menos un 96% de precisión global en la suite de evaluación.
- [ ] Cero alucinaciones numéricas en respuestas auditadas contra datos de prueba.

### Validación

```bash
pnpm --filter @mybusiness/agent-service test:golden-dataset
pnpm --filter @mybusiness/finance-service test:paypal
```

---

## SF5-07 — [DevOps] Pipeline de seguridad integral y dependencias (SAST/DAST y escaneo de contenedores)

**Labels:** `phase-5`, `sprint-9`, `ci-cd`, `devops`, `security`  
**Owner:** Farid (@farid15berrio10-a11y) · **SP:** 6 · **Depende de:** #70, #72, #76

### Contexto

Con la migración a GitLab CI completada (MIG-01 a MIG-08), es momento de activar las defensas automatizadas continuas en el pipeline para evitar que regresiones de seguridad, dependencias obsoletas o configuraciones erróneas lleguen a las ramas principales `develop` y `main`.

### Alcance

- Integración de escaneo de vulnerabilidades en imágenes Docker con Trivy en modo bloqueante (falla si existen vulnerabilidades no corregidas de severidad `HIGH` o `CRITICAL`).
- Escaneo continuo de dependencias con `pnpm audit --audit-level=high` integrado en los jobs de calidad del monorepo.
- Configuración de Quality Gate estricto en SonarCloud: cobertura mínima global de pruebas $\ge 80\%$, duplicación de código $< 3\%$ y 0 Security Hotspots abiertos.
- Escaneo de secretos en el repositorio mediante Gitleaks para prevenir la filtración accidental de claves o tokens en commits.
- Ejecución de job DAST baseline con OWASP ZAP contra el entorno de staging tras cada despliegue exitoso desde `develop`.

### Fuera de alcance

- Escaneo de código en plataformas de nube de terceros fuera de GitLab CI.
- Pruebas manuales de ingeniería inversa en aplicaciones móviles empaquetadas (cubiertas en Fase 4).

### Criterios de aceptación

- [ ] El pipeline de GitLab CI bloquea automáticamente cualquier Merge Request con dependencias vulnerables HIGH/CRITICAL.
- [ ] El análisis de SonarCloud es obligatorio y verde para poder fusionar en `develop`.
- [ ] El análisis de Gitleaks valida el historial y ramas sin alertar falsos positivos con secretos de prueba.
- [ ] El reporte DAST de OWASP ZAP se publica como artefacto del pipeline y genera alertas automáticas si detecta problemas de seguridad.

### Validación

```bash
pnpm audit --audit-level=high
gitlab-runner exec docker test-security  # o simulación local con Trivy y Sonar
```
