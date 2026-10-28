# ADR 001 — ORM y migraciones: Drizzle ORM

- **Estado:** Aceptado
- **Fecha:** 2026-10-26
- **Issues:** #11 (ADRs iniciales), #3 (esquema de Auth)

## Contexto

El monorepo sigue el patrón Database-per-Service: cada microservicio tiene su propia base de datos (`auth_db`, `finance_db`, `agent_db`, `audit_db`) y no deben existir joins entre ellas. Necesitábamos un ORM que permitiera:

- Definir el esquema con tipos estrictos y migraciones versionadas por servicio.
- Ejecutar SQL específico de PostgreSQL, en particular `pgvector` y el operador coseno `<=>` en `agent-service`.
- Evitar acoplar el dominio a un cliente generado o a un runtime pesado.

## Decisión

Usar **Drizzle ORM** con **drizzle-kit** y el driver `node-postgres` (`pg`).

- Cada servicio declara su esquema en `src/database/schema.ts`.
- Las migraciones se generan y versionan dentro del propio servicio (`drizzle/`).
- La conexión se crea mediante una factory (`src/database/client.ts`) para facilitar tests y evitar conexiones al importar.
- Los enums de base de datos se mantienen alineados manualmente con `packages/contracts/src/enums`.
- Para `pgvector` se usará `customType` y SQL tipado de Drizzle (`sql`, `cosineDistance`), sin necesidad de un ORM distinto para `agent-service`.

Scripts por servicio:

```bash
pnpm --filter @mybusiness/auth-service db:generate
pnpm --filter @mybusiness/auth-service db:migrate
pnpm --filter @mybusiness/auth-service db:seed
```

## Consecuencias

**Positivas**

- SQL-first: control total del DDL y de las extensiones de PostgreSQL.
- Tipado inferido (`$inferSelect` / `$inferInsert`) sin codegen adicional.
- Migraciones aisladas y reproducibles por microservicio.

**Negativas / a vigilar**

- No hay integración por decoradores con NestJS: la inyección del cliente se hace con un provider explícito.
- Los enums de TypeScript y los de PostgreSQL deben sincronizarse a mano.
- El equipo debe respetar el flujo `generate` → revisar SQL → `migrate` (no editar snapshots a mano).

## Alternativas descartadas

- **Prisma:** excelente DX, pero `pgvector` requiere tipos `Unsupported` y consultas raw, y añade un cliente generado por servicio.
- **TypeORM:** integración nativa con Nest, pero migraciones menos predecibles y mayor fricción con tipos personalizados.
- **SQL plano + `pg`:** máximo control, pero sin tipado de entidades ni generación de migraciones.
