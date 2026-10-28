# Revisión conjunta ADRs — Issue #11

- **Fecha de revisión:** 2026-10-28
- **Rama:** `docs/adr-review-#11` (desde `develop`)
- **Alcance:** ADR-001, ADR-002, ADR-003 y ADR-004
- **Revisores:** A (autor de la verificación) y B (aprobación pendiente)

## Objetivo

Cerrar #11 con la aprobación de ambos desarrolladores sobre los 4 ADRs iniciales.
Este documento registra la evidencia de verificación ejecutada y los puntos que B
debe aprobar explícitamente antes del cierre.

## ADRs a revisar

| ADR                                       | Tema             | Estado   |
| ----------------------------------------- | ---------------- | -------- |
| [ADR-001](../adr/001-orm-drizzle.md)      | ORM Drizzle      | Aceptado |
| [ADR-002](../adr/002-transporte-redis.md) | Transporte Redis | Aceptado |
| [ADR-003](../adr/003-dinero.md)           | Dinero           | Aceptado |
| [ADR-004](../adr/004-contratos.md)        | Contratos        | Aceptado |

## Checklist de verificación (ejecutado)

- [x] Sin referencias contradictorias a `Transport.TCP` en código/config.
      `apps/`, `packages/`, `docker/` y `.env.example` no contienen `Transport.TCP`
      ni URLs `tcp://`; solo quedan las 2 menciones históricas/alternativa descartada
      en ADR-002.
- [x] `packages/contracts` es la única fuente de DTOs y patrones.
      29 imports desde `@mybusiness/contracts` en 29 archivos de `apps/` y
      `packages/` (sin contar `dist/` ni `node_modules/`). No se detectaron DTOs
      duplicados por servicio.
- [ ] Sin `any` en contratos públicos (`packages/contracts/src`).
      **Hallazgo:** quedan 3 ocurrencias de `Record<string, any>`:
      `src/dtos/agent.dto.ts:18`, `src/dtos/audit.dto.ts:10` y
      `src/dtos/audit.dto.ts:11`. Ver «Hallazgos y acciones».
- [x] `money.ts` implementa `amountMinor: string`, `currency` ISO 4217 y patrón entero.
      `MONEY_MINOR_PATTERN = /^\d+$/`, `CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/` y
      `MAX_MONEY_MINOR_DIGITS = 19`. En `finance-service` los importes se persisten
      como `bigint` (`currentBalanceMinor`, `amountMinor`, `subtotalMinor`,
      `taxAmountMinor`, `totalAmountMinor`).
- [x] Idempotencia respaldada por base de datos:
      `uniqueIndex('transactions_tenant_idempotency_uq')` sobre
      `(tenantId, idempotencyKey)` en `apps/finance-service/src/database/schema.ts`.
- [x] `.env.example` coherente con Redis (sin TCP): `REDIS_HOST`, `REDIS_PORT` y
      `REDIS_PASSWORD`; ningún parámetro `tcp`.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` en verde.

### Evidencia de comandos

| Comando          | Resultado                                                            |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm build`     | OK (exit 0)                                                          |
| `pnpm typecheck` | OK (exit 0)                                                          |
| `pnpm lint`      | OK (exit 0, `--max-warnings=0`)                                      |
| `pnpm test`      | OK — 14 archivos, 77 tests (agent 3, finance 5, gateway 46, auth 23) |
| `pnpm test:e2e`  | OK — 2 archivos, 13 tests                                            |

## Puntos de decisión para aprobación de B

1. **ADR-002:** Redis Pub/Sub es _at-most-once_; BullMQ se reserva para jobs
   durables con reintentos y dead-letter queues. ¿Conforme?
2. **ADR-003:** importes `BIGINT` + `string` entero en JSON; `currency` ISO 4217;
   idempotencia con `UNIQUE (tenant_id, idempotency_key)`. ¿Conforme?
3. **ADR-004:** contratos versionados `*V2` para cambios incompatibles, manteniendo
   la versión anterior durante la transición. ¿Conforme?
4. **ADR-001:** migraciones aisladas por servicio con `drizzle-kit`
   (`generate` → revisar SQL → `migrate`). ¿Conforme?

## Hallazgos y acciones

1. **`any` en contratos públicos (bloqueante del checklist).**
   Sustituir `Record<string, any>` por un tipo JSON serializable compartido
   (por ejemplo `Record<string, unknown>` o `JsonValue`) en `agent.dto.ts` y
   `audit.dto.ts`, y verificar que los consumidores sigan compilando.
2. **Conteo de imports corregido.** El borrador indicaba 42 imports; la medición
   real es 29 imports en 29 archivos. Se documenta el valor verificado.
3. **Sin otras desviaciones** frente a lo declarado en los 4 ADRs.

## Criterios de cierre

- [ ] Aprobación explícita de B en el issue #11.
- [ ] Checklist marcado (pendiente el punto de `any` en contratos públicos).
- [ ] Issue #11 cerrado.
