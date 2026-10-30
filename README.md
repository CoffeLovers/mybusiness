# 💼 MyBusiness — Plataforma Financiera y Contable Inteligente

[![Status](https://img.shields.io/badge/Status-Fase%201%20en%20Desarrollo-blue.svg)](https://github.com/Umbrex47/mybusiness/issues/10)
[![Backend Architecture](https://img.shields.io/badge/Backend-NestJS%20Microservices-ea2845.svg)](https://docs.nestjs.com/microservices/basics)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%2016%20%2B%20pgvector-336791.svg)](https://github.com/pgvector/pgvector)
[![Broker & Queues](<https://img.shields.io/badge/Broker%20%26%20Queues-Redis%207%20(Pub%2FSub%20%2B%20BullMQ)-dc382d.svg>)](https://redis.io/)
[![Security](https://img.shields.io/badge/Security-JWT%20%7C%20RBAC%20%7C%20Argon2id-critical.svg)](#seguridad-y-cumplimiento)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions%20%7C%20SonarQube%20%7C%20Trivy-2088FF.svg)](#devops-y-cicd)

**MyBusiness** es una plataforma integral de gestión financiera, contable y operativa para empresas y personas independientes. El backend está diseñado bajo una **arquitectura de microservicios con NestJS** en un monorepo modular, desacoplando dominios de negocio, garantizando alta disponibilidad, aislamiento de fallos y escalabilidad elástica.

---

## 🏗️ Arquitectura de Microservicios

El sistema adopta el patrón **API Gateway + Microservicios de Dominio** con comunicación híbrida (Síncrona vía RPC con transporte Redis y Asíncrona basada en eventos con Redis Pub/Sub):

```mermaid
flowchart TD
    subgraph Clients ["Capa de Clientes"]
        WebClient["Portal Web (Next.js + React)"]
        MobileClient["App Móvil Android (Kotlin + Jetpack Compose)"]
        ExternalClient["Integraciones Externas / APIs"]
    end

    subgraph GatewayLayer ["Perímetro y Entrada: API Gateway"]
        Gateway["API Gateway (NestJS)
- Reverse Proxy & Routing
- Rate Limiting base (Redis distribuido en #7)
- Helmet & CORS
- Validación JWT Perimetral"]
    end

    subgraph EventBroker ["Bus de Mensajería & Transporte"]
        RedisBus[("Redis 7: Event Bus & Broker
(Transporte Redis / PubSub / BullMQ Streams)")]
    end

    subgraph Microservices ["Microservicios de Backend (NestJS)"]
        AuthService["Auth & Identity Service
- Tenant / Company
- Users & RBAC
- Refresh Tokens con hash SHA-256"]
        FinanceService["Finance & Banking Service
- BankAccounts & Balances
- Transactions & Deduplication
- Invoices & Conciliación"]
        AgentService["Agent Memory Service
- Embeddings 1536d
- Búsqueda Semántica Vectorial"]
        AuditService["Audit & Logging Service
- Trazabilidad Inmutable
- Consumo Asíncrono de Eventos"]
    end

    subgraph Persistence ["Capa de Persistencia (Database-per-Service)"]
        AuthDB[("Auth DB (Postgres)")]
        FinanceDB[("Finance DB (Postgres)")]
        AgentDB[("Agent DB (Postgres + pgvector)")]
        AuditDB[("Audit DB (Postgres / Append-only)")]
    end

    Clients --> Gateway
    Gateway -->|HTTP / REST| Gateway
    Gateway -->|RPC (Redis Pub/Sub)| AuthService
    Gateway -->|RPC (Redis Pub/Sub)| FinanceService
    Gateway -->|RPC (Redis Pub/Sub)| AgentService

    AuthService -.->|Eventos Asíncronos| RedisBus
    FinanceService -.->|Eventos Asíncronos| RedisBus
    RedisBus -.->|Sub: Log Event| AuditService

    AuthService --> AuthDB
    FinanceService --> FinanceDB
    AgentService --> AgentDB
    AuditService --> AuditDB
```

---

## 🧩 Catálogo de Microservicios

| Servicio              | Responsabilidad de Dominio                                                                                    | Comunicación                                                       | Almacenamiento                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| **`api-gateway`**     | Punto de entrada único, routing, rate-limiting distribuido, CORS, Helmet y verificación JWT.                  | HTTP REST (hacia clientes) / RPC (hacia microservicios)            | Redis (Broker, Rate-Limiting Distribuido) |
| **`auth-service`**    | Gestión de Tenants (empresas), usuarios, login, registro, rotación de Refresh Tokens con hash SHA-256 y RBAC. | RPC (Request-Response) + Eventos (UserRegistered, TenantCreated)   | PostgreSQL (`auth_db`)                    |
| **`finance-service`** | Cuentas bancarias, transacciones con deduplicación por clave de idempotencia, facturas e impuestos.           | RPC (Request-Response) + Eventos (TransactionCreated, InvoicePaid) | PostgreSQL (`finance_db`)                 |
| **`agent-service`**   | Memoria semántica del agente de IA, indexación vectorial con pgvector (HNSW) y recuperación contextual.       | RPC (Similarity Search, Store Memory)                              | PostgreSQL + `pgvector` (`agent_db`)      |
| **`audit-service`**   | Registro inmutable de auditoría (append-only), trazabilidad de acciones y cambios de estado.                  | Asíncrona (EventPattern subscriber vía Redis)                      | PostgreSQL (`audit_db`)                   |

---

## 💻 Stack Tecnológico

| Capa / Componente           | Tecnología                                                                                                        | Propósito                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend Framework**       | [NestJS](https://nestjs.com/) (Microservices Module)                                                              | Framework modular con soporte nativo para microservicios (`@MessagePattern`, `@EventPattern`).                                                                                    |
| **Transport Layer**         | [Redis 7](https://redis.io/) (Pub/Sub para RPC/Eventos + BullMQ para colas durables)                              | Bus de transporte para mensajes RPC (`@MessagePattern`), eventos desacoplados (`@EventPattern`) y colas durables BullMQ. Decisión en [ADR 002](docs/adr/002-transporte-redis.md). |
| **Cliente Móvil**           | [Kotlin](https://kotlinlang.org/) + [Jetpack Compose](https://developer.android.com/jetpack/compose) (Material 3) | App Android nativa; consume exclusivamente el API Gateway mediante JWT.                                                                                                           |
| **Cliente Web**             | [Next.js](https://nextjs.org/) + React + TypeScript                                                               | Portal BFF para análisis de escritorio, tablas densas y conciliación masiva. Decisión en [ADR 006](docs/adr/006-portal-web-nextjs.md).                                            |
| **Base de Datos**           | [PostgreSQL 16](https://www.postgresql.org/)                                                                      | Persistencia ACID estructurada bajo patrón Database-per-Service (o esquemas aislados).                                                                                            |
| **ORM y Migraciones**       | [Drizzle ORM](https://orm.drizzle.team/) + `drizzle-kit`                                                          | Esquemas tipados y migraciones aisladas por microservicio (un `schema.ts` y un historial `drizzle/` por servicio). Decisión en [ADR 001](docs/adr/001-orm-drizzle.md).            |
| **Precisión Monetaria**     | `BIGINT` en unidades menores + `string` en JSON                                                                   | Importes exactos sin `float`; los DTOs usan `*Minor` y moneda ISO 4217. Decisión en [ADR 003](docs/adr/003-dinero.md).                                                            |
| **Contratos Compartidos**   | `@mybusiness/contracts`                                                                                           | DTOs, enums, `MessagePatterns` y `EventPatterns` como fuente única de verdad. Decisión en [ADR 004](docs/adr/004-contratos.md).                                                   |
| **Memoria Vectorial**       | [pgvector](https://github.com/pgvector/pgvector)                                                                  | Búsqueda por similitud semántica de embeddings para el agente de IA.                                                                                                              |
| **Caché y Colas**           | [Redis 7](https://redis.io/) / [BullMQ](https://bullmq.io/)                                                       | Rate-limiting distribuido atómico con Lua script sobre Redis 7, colas de procesamiento en segundo plano y caché. Decisión en [ADR 005](docs/adr/005-rate-limiting-fail-mode.md).  |
| **Seguridad Criptográfica** | Argon2id, SHA-256 para Refresh Tokens y JWT                                                                       | Hashing de passwords, tokens opacos con hash de una sola vía y Access Tokens de corta duración.                                                                                   |
| **Contenedores**            | [Docker](https://www.docker.com/) & Docker Compose                                                                | Orquestación reproducible de microservicios y dependencias locales.                                                                                                               |
| **CI / CD**                 | [GitHub Actions](https://github.com/features/actions)                                                             | Pipelines automatizados de linting, typecheck, tests y builds paralelos de microservicios.                                                                                        |
| **Seguridad Estática**      | [SonarQube](https://www.sonarqube.org/) & [Trivy](https://trivy.dev/)                                             | Análisis estático (SAST), detección de dependencias vulnerables y escaneo de contenedores.                                                                                        |

---

## 📁 Estructura del Repositorio (Monorepo)

```bash
mybusiness/
├── apps/
│   ├── api-gateway/          # Entrada HTTP, autenticación perimetral, rate-limiting
│   ├── auth-service/         # Identidad, Tenants y RBAC (Drizzle ORM + auth_db)
│   ├── finance-service/      # Microservicio Financiero (Bancos, Transacciones, Facturas)
│   ├── agent-service/        # Microservicio de Memoria de IA (pgvector)
│   ├── audit-service/        # Microservicio de Auditoría inmutable (Consumidor asíncrono)
│   ├── web/                  # Portal web (Next.js + React + TypeScript)
│   └── mobile-android/       # App móvil Android (Kotlin + Jetpack Compose)
├── packages/
│   ├── common/               # Decoradores, filtros globales, guards compartidos
│   ├── contracts/            # DTOs, EventPatterns, MessagePatterns y contratos tipados
│   └── database/             # Utilidades compartidas de BD (el esquema Drizzle vive en cada servicio)
├── docker/
│   ├── docker-compose.yml    # Infraestructura: Postgres (pgvector) y Redis
│   └── init-microservices-dbs.sh
├── .github/
│   └── workflows/            # Pipelines CI/CD y análisis de seguridad
└── README.md
```

---

## 🗄️ Modelo de Datos por Servicio

Siguiendo el principio de **Database-per-Service** (con bases de datos o esquemas independientes en PostgreSQL para mantener bajo acoplamiento). Cada servicio define su esquema con **Drizzle ORM** y versiona sus propias migraciones en `drizzle/`; no existen joins entre bases de datos de servicios distintos.

1. **`auth-service` (`auth_db`)**:
   - `Tenant` (Company): Empresa, taxId (RUT/RFC/NIF), timezone, moneda default, estado.
   - `User`: Credenciales (Argon2id), roles (RBAC: `SUPER_ADMIN`, `TENANT_ADMIN`, `ACCOUNTANT`, etc.), asociación a tenants.
   - `RefreshToken`: Token opaco almacenado como hash SHA-256 (`token_hash`) con `familyId` para detección y revocación automática de reuso. El token en claro nunca se persiste.
2. **`finance-service` (`finance_db`)**:
   - `BankAccount`: Entidad financiera, número enmascarado, moneda, saldos en unidades menores y metadatos.
   - `Transaction`: `amountMinor` entero, divisa, tipo (ingreso/egreso), `idempotencyKey` obligatoria por tenant, fecha y estado.
   - `Invoice`: Facturas emitidas/recibidas, numeración por tenant, impuestos y totales en unidades menores, ítems y enlace a transacción. Ver [ADR 003](docs/adr/003-dinero.md).
3. **`agent-service` (`agent_db`)**:
   - `AgentMemory`: Contenido textual, metadata y columna de vector embedding (`vector(1536)`) con índice HNSW para búsqueda por distancia coseno.
4. **`audit-service` (`audit_db`)**:
   - `AuditLog`: Registro append-only (actorId, tenantId, acción, entidad, diff de cambios, IP, user-agent).

---

## 🔐 Seguridad y Propagación de Contexto

- **Autenticación en Gateway**: El `api-gateway` valida el Access Token JWT emitido por `auth-service`, adjunta la identidad y el tenant al request y usa esos datos en las llamadas RPC a los microservicios internos. Los Refresh Tokens viajan en cookies `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- **Aislamiento Multi-Tenant**: Cada microservicio aplica internamente el filtro obligatorio de `tenantId` en sus consultas, impidiendo accesos cruzados (prevención hermética de vulnerabilidades IDOR).
- **Protección Perimetral y Rate-Limiting**: `@nestjs/throttler` con almacenamiento distribuido atómico en Redis vía script Lua coordina réplicas del Gateway. Políticas diferenciadas: `auth` (5 req/min por IP estricta con `trust proxy`), `api` (100 req/min por tenant o IP) y `heavy` (10 req/min por tenant para endpoints intensivos). Resiliencia híbrida documentada en [ADR 005](docs/adr/005-rate-limiting-fail-mode.md) (fallback local en memoria ante indisponibilidad de Redis sin degradar seguridad de auth). Endurecimiento perimetral con Helmet, CORS estricto y cabeceras estándar RFC `Retry-After` y `X-RateLimit-*`.
- **Trazabilidad Asíncrona**: Cada operación crítica emite un evento al bus de Redis que es procesado de forma no bloqueante por el `audit-service`.

### Endpoints de Autenticación

| Método | Ruta                    | Acceso  | Descripción                                               |
| ------ | ----------------------- | ------- | --------------------------------------------------------- |
| POST   | `/api/v1/auth/register` | Público | Crea tenant + usuario administrador y abre una sesión.    |
| POST   | `/api/v1/auth/login`    | Público | Valida credenciales y abre una sesión.                    |
| POST   | `/api/v1/auth/refresh`  | Cookie  | Rota el Refresh Token y renueva el Access Token.          |
| POST   | `/api/v1/auth/logout`   | Cookie  | Revoca la familia de Refresh Tokens y limpia las cookies. |
| GET    | `/api/v1/auth/me`       | JWT     | Devuelve el perfil y el tenant del usuario autenticado.   |

`login`, `register` y `refresh` establecen las cookies `HttpOnly` `mybusiness_access_token` y `mybusiness_refresh_token`; el Gateway no devuelve el Refresh Token en el cuerpo. `GET /me` acepta el Access Token en la cookie o como `Authorization: Bearer <token>`. El límite de intentos es de 5 req/min para `login` y `register`.

### Endpoints de Finance

| Método | Ruta                           | Acceso    | Descripción                                      |
| ------ | ------------------------------ | --------- | ------------------------------------------------ |
| GET    | `/api/v1/finance/accounts`     | JWT       | Lista las cuentas del tenant.                    |
| POST   | `/api/v1/finance/accounts`     | JWT + rol | Crea una cuenta bancaria.                        |
| GET    | `/api/v1/finance/transactions` | JWT       | Lista los movimientos del tenant.                |
| POST   | `/api/v1/finance/transactions` | JWT + rol | Crea una transacción idempotente.                |
| GET    | `/api/v1/finance/invoices`     | JWT       | Lista las facturas del tenant.                   |
| POST   | `/api/v1/finance/invoices`     | JWT + rol | Crea una factura.                                |
| POST   | `/api/v1/finance/invoices/pay` | JWT + rol | Marca una factura como pagada y emite el evento. |

Los roles habilitados para escritura son `ACCOUNTANT`, `TENANT_ADMIN` y `SUPER_ADMIN`. El detalle de invariantes y eventos está en [docs/finance-domain.md](docs/finance-domain.md).

---

## 🚀 Estado del Proyecto — Fase 1 (Sprints 1 y 2)

El desarrollo del proyecto se encuentra estructurado en torno al diseño de microservicios:

📍 **Master Epic de Seguimiento**: [#10 — Fase 1: Cimientos de Infraestructura, Seguridad y Modelado de Datos](https://github.com/Umbrex47/mybusiness/issues/10)
📘 **Plan Integral v2**: [docs/PLAN-INTEGRAL-DESARROLLO.md](docs/PLAN-INTEGRAL-DESARROLLO.md)
🗺️ **Fase 2 (Sprints 3–4)**: [docs/sprints/fase-2/README.md](docs/sprints/fase-2/README.md) · [Issues](docs/sprints/fase-2/ISSUES.md)

### Sprint 1: Arquitectura de Microservicios, Infraestructura y Datos

- [x] [#1 — [Sprint 1][Setup] Monorepo y arquitectura de microservicios (API Gateway, Servicios y App Móvil Kotlin)](https://github.com/Umbrex47/mybusiness/issues/1)
- [x] [#2 — [Sprint 1][Infra] PostgreSQL con pgvector y Redis como Event Bus/Broker y Caché](https://github.com/Umbrex47/mybusiness/issues/2)
- [x] [#3 — [Sprint 1][Database] Esquema de Auth Service: Tenant/Company y User](https://github.com/Umbrex47/mybusiness/issues/3)
- [ ] [#4 — [Sprint 1][Database] Esquemas de Finance Service, Audit Service y Agent Memory (pgvector)](https://github.com/Umbrex47/mybusiness/issues/4)
- [ ] [#11 — [Sprint 1][Architecture] ADRs iniciales: transporte, ORM, precisión monetaria y contratos](https://github.com/Umbrex47/mybusiness/issues/11) — ADRs 001–004 publicados; pendiente confirmación de B.
- [ ] [#12 — [Sprint 1][Mobile] App Android en Kotlin: base, autenticación y dashboard](https://github.com/Umbrex47/mybusiness/issues/12)

### Sprint 2: Autenticación, Seguridad y Pipelines CI/CD

- [x] [#5 — [Sprint 2][Security] Auth Service con JWT y Refresh Tokens opacos (hash SHA-256)](https://github.com/Umbrex47/mybusiness/issues/5)
- [ ] [#6 — [Sprint 2][Security] RBAC y propagación de contexto Multi-Tenant entre microservicios](https://github.com/Umbrex47/mybusiness/issues/6)
- [x] [#7 — [Sprint 2][Security] Rate-Limiting distribuido en API Gateway con Redis y endurecimiento HTTP](https://github.com/Umbrex47/mybusiness/issues/7)
- [ ] [#8 — [Sprint 2][DevOps] Pipelines de CI para Microservicios en GitHub Actions (Lint, Tests, Build)](https://github.com/Umbrex47/mybusiness/issues/8)
- [ ] [#9 — [Sprint 2][DevOps] Análisis estático de seguridad (SAST) y escaneo de imágenes con SonarQube y Trivy](https://github.com/Umbrex47/mybusiness/issues/9)
- [ ] [#13 — [Sprint 2][Finance] Lógica de dominio del finance-service: cuentas, transacciones idempotentes y facturación](https://github.com/Umbrex47/mybusiness/issues/13)
- [ ] [#14 — [Sprint 2][Agent] Memoria vectorial del agent-service con pgvector y embeddings](https://github.com/Umbrex47/mybusiness/issues/14)
- [ ] [#15 — [Sprint 2][Audit] audit-service: consumidor asíncrono append-only de eventos](https://github.com/Umbrex47/mybusiness/issues/15)

---

## ⚡ Guía de Inicio Rápido (Desarrollo Local)

### Prerrequisitos

- **Node.js** >= 20.x
- **pnpm** 12.x (`corepack enable`)
- **Docker** & **Docker Compose**
- **JDK 17+** y **Android Studio** (solo para la app móvil)
- **Git**

### 1. Clonar el repositorio

```bash
git clone https://github.com/Umbrex47/mybusiness.git
cd mybusiness
```

### 2. Configuración de Entorno

Copia el archivo de variables de entorno de ejemplo:

```bash
cp .env.example .env
```

> [!IMPORTANT]
> Si el puerto `5432` está ocupado, cambia `POSTGRES_PORT` y el puerto de las cuatro `*_DATABASE_URL` al mismo valor. `pnpm test:infra` valida que ambos coincidan.

### 3. Levantar Infraestructura Base

Inicia PostgreSQL (con `pgvector`) y Redis (Broker de eventos y colas):

```bash
# Iniciar PostgreSQL 16 (pgvector) y Redis 7 con persistencia AOF
pnpm docker:up
# O directamente con Compose usando el archivo .env de la raíz:
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Verificar estado healthy de los contenedores:

```bash
docker compose --env-file .env -f docker/docker-compose.yml ps
```

> [!NOTE]
> **Actualización no destructiva en volúmenes existentes:**
> Los scripts en /docker-entrypoint-initdb.d solo se ejecutan al crear un volumen nuevo. Si ya tienes un volumen inicializado, aplica de forma no destructiva las 4 bases, roles de servicio y extensiones con:
>
> ```bash
> docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres /docker-entrypoint-initdb.d/init-microservices-dbs.sh
> ```
>
> El script también reasigna los objetos del rol legacy `mybusiness_user` y elimina ese rol si existe.

### 4. Instalar Dependencias del Monorepo

```bash
pnpm install
```

### 5. Aplicar el Esquema de Auth (Drizzle)

```bash
pnpm --filter @mybusiness/auth-service db:migrate
pnpm --filter @mybusiness/auth-service db:seed
```

El seed crea la empresa y el usuario demo usando `SEED_TENANT_*`, `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` definidos en `.env` (solo para desarrollo). No hay credenciales de seed embebidas en el código.

### 6. Verificar Infraestructura

Con los contenedores `healthy` y las dependencias instaladas:

```bash
pnpm test:infra
```

La verificación **falla por defecto** si PostgreSQL o Redis no están disponibles, si el Redis no tiene AOF o si no se puede reiniciar el Redis de Compose. No se acepta una validación meramente declarativa como sustituto. El script aplica automáticamente las migraciones y el seed de Auth antes de probar el login real, la rotación y la detección de reuso de Refresh Tokens.

### 7. Iniciar Microservicios en Desarrollo

```bash
# Iniciar todos los microservicios y el gateway simultáneamente:
pnpm dev

# O iniciar un microservicio específico:
pnpm dev:gateway
pnpm dev:auth
pnpm dev:finance
pnpm dev:agent
pnpm dev:audit
```

### 8. Ejecutar la App Móvil (Android)

```bash
cd apps/mobile-android
./gradlew assembleDebug
```

La app consume el API Gateway mediante `API_BASE_URL`. Desde el emulador Android, el host local se referencia como `http://10.0.2.2:3000/api/v1`.

---

## 🧪 Pruebas y Calidad de Código

```bash
# Verificación de linter y formateo en todo el monorepo
pnpm lint
pnpm format

# Chequeo estático de tipos
pnpm typecheck

# Pruebas unitarias de microservicios
pnpm test

# Pruebas de integración inter-servicio / e2e
pnpm test:e2e

# Reporte de cobertura global
pnpm test:cov
```

---

## 🛡️ Seguridad & Contribuciones

Si descubres una vulnerabilidad potencial de seguridad en este proyecto, repórtala de manera responsable a través de un Security Advisory privado en GitHub.

Las contribuciones siguen el estándar de [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) y requieren que todos los checks de CI (incluyendo análisis de SonarQube y Trivy) pasen exitosamente antes del merge.

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
