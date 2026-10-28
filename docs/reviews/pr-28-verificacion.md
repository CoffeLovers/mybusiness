# Verificación PR #28 — Esquemas de datos (finance / audit / agent)

**PR:** [#28](https://github.com/CoffeLovers/mybusiness/pull/28)
**Rama:** `feat/database-finance-audit-agent-schemas-#4` → `main`
**Commit revisado:** `d999a00`
**Issue:** #4 · **Refs:** #10, #11
**Fecha de verificación:** 2026-10-28
**Entorno:** Node 24.21 · pnpm 12.9.1 · PostgreSQL 16 (`pgvector/pgvector:pg16`) · pgvector 0.8.7

---

## 1. Alcance revisado

| Servicio                | Base         | Entidades                                   |
| ----------------------- | ------------ | ------------------------------------------- |
| `finance-service`       | `finance_db` | `bank_accounts`, `transactions`, `invoices` |
| `audit-service`         | `audit_db`   | `audit_logs` (append-only por trigger)      |
| `agent-service`         | `agent_db`   | `agent_memories` (`vector(1536)` + HNSW)    |
| `@mybusiness/contracts` | —            | enum `SyncStatus`                           |

28 archivos, +2118/-3.

---

## 2. Verificaciones ejecutadas

### 2.1 Pipeline del workspace

| Comando                                               | Resultado                      |
| ----------------------------------------------------- | ------------------------------ |
| `pnpm -r run build`                                   | ✅ 8/8 proyectos               |
| `pnpm typecheck`                                      | ✅ sin errores                 |
| `pnpm lint` (`--max-warnings=0`)                      | ✅ sin warnings                |
| `pnpm test:schemas` (`node scripts/verify-issue4.js`) | ✅ 19/19                       |
| `pnpm test` / `pnpm test:e2e`                         | ⚠️ no ejecutan nada (ver §4.2) |

### 2.2 Migraciones reales (`drizzle-kit migrate`) sobre bases vírgenes

Se crearon bases temporales nuevas (sin tablas ni ledger) y se corrió el comando que usa el proyecto en producción. Resultado: **14/14**.

| Comprobación                                  | Finance | Audit | Agent |
| --------------------------------------------- | ------- | ----- | ----- |
| `drizzle-kit migrate` sin error               | ✅      | ✅    | ✅    |
| Ledger `__drizzle_migrations` con 1 migración | ✅      | ✅    | ✅    |
| Tablas creadas                                | ✅      | ✅    | ✅    |
| `amount_minor` es `BIGINT`                    | ✅      | —     | —     |
| Índice `UNIQUE (tenant_id, idempotency_key)`  | ✅      | —     | —     |
| FK de `invoices`                              | ✅      | —     | —     |
| Triggers de inmutabilidad                     | —       | ✅    | —     |
| Índice HNSW `vector_cosine_ops`               | —       | —     | ✅    |
| `embedding` declara 1536 dims                 | —       | —     | ✅    |

> Las bases se eliminaron al terminar. No se tocaron las bases de desarrollo.

### 2.3 Integración funcional contra PostgreSQL real

| Comprobación                                                  | Resultado |
| ------------------------------------------------------------- | --------- |
| `audit_logs`: `UPDATE` rechazado por trigger                  | ✅        |
| `audit_logs`: `DELETE` rechazado por trigger                  | ✅        |
| Registro intacto tras los intentos de mutación                | ✅        |
| pgvector instalado (0.8.7)                                    | ✅        |
| Búsqueda por distancia coseno devuelve el vecino correcto     | ✅        |
| Misma `idempotencyKey` permitida en otro tenant (aislamiento) | ✅        |
| `idempotencyKey` duplicada en el mismo tenant → `23505`       | ✅        |
| Invoice con `associatedTransactionId` válido                  | ✅        |
| Invoice con transacción inexistente → `23503` (FK)            | ✅        |

**15/15.**

### 2.4 Seeders: ejecución doble (idempotencia)

Se migraron bases nuevas y se corrió cada seeder dos veces seguidas.

| Servicio          | Run #1 | Run #2 | Idempotente               |
| ----------------- | ------ | ------ | ------------------------- |
| `finance-service` | 1/1/1  | 1/1/1  | ✅                        |
| `audit-service`   | 2      | 2      | ✅ (corregido en este PR) |
| `agent-service`   | 2      | 2      | ✅ (corregido en este PR) |

**9/9 tras la corrección.** Antes de la corrección: audit pasaba de 2 → 4 y agent de 2 → 4 filas.

---

## 3. Correcciones aplicadas durante la revisión

### 3.1 Seeders no idempotentes (audit y agent)

El PR afirmaba _"seeders de desarrollo idempotentes en cada servicio"_, pero solo `finance-service` lo era.

**Causa:** `audit-service` y `agent-service` hacían `INSERT` incondicional en cada ejecución.

**Corrección:** guarda de existencia antes de insertar.

- `apps/audit-service/src/database/seed.ts`: busca por `(tenantId, entityId='seed')`. No se puede usar `DELETE`/`UPSERT` porque los triggers de inmutabilidad lo impiden; la idempotencia se resuelve leyendo antes de escribir.
- `apps/agent-service/src/database/seed.ts`: busca cualquier memoria del tenant semilla antes de insertar.

Ambos seeders ahora imprimen `ya aplicado` y no duplican.

---

## 4. Observaciones no bloqueantes

### 4.1 Prerrequisito operativo: extensión `vector`

Las migraciones **no** ejecutan `CREATE EXTENSION IF NOT EXISTS vector`. La dependencia sí está cubierta por la infraestructura (`docker/init-microservices-dbs.sh`, líneas 136-137), que crea `uuid-ossp` y `vector` en las cuatro bases.

Consecuencia: `drizzle-kit migrate` sobre una base nueva de `agent_db` **falla** si la extensión no fue creada antes. Queda documentado como prerrequisito del entorno, no como defecto del esquema. Si en el futuro se aprovisionan bases fuera del script de init, hay que crear la extensión primero.

### 4.2 No existen tests automatizados de servicios

Ningún `apps/*` ni `packages/*` define script `test`. Por eso:

- `pnpm test` no ejecuta nada.
- `pnpm test:e2e` (script raíz) es un no-op para estos paquetes.

La única verificación automatizada es `scripts/verify-issue4.js`. Se recomienda un follow-up para incorporar tests unitarios de los esquemas y un e2e real en CI.

### 4.3 `verify-issue4.js` solo prueba `finance_db` en vivo

La sección de integración del script:

- Se conecta únicamente a `FINANCE_DATABASE_URL`.
- Aplica la migración de finance con SQL crudo (no usa el ledger de Drizzle).
- No valida triggers de audit ni pgvector/HNSW de agent en vivo: eso solo se comprueba de forma estática.
- **Deja datos**: cada ejecución inserta 1 `bank_account` y 1 `transaction` sin limpiar. Medido: 5 → 6 filas por corrida.

Recomendación: extenderlo o reemplazarlo por el e2e de §2.2–2.4, que sí cubre los tres servicios y limpia.

### 4.4 Diferencias menores entre el PR y el código

| PR dice                                 | Real                                |
| --------------------------------------- | ----------------------------------- |
| Índice `agent_memories_embedding_idx`   | `agent_memories_embedding_hnsw_idx` |
| "17/17 comprobaciones"                  | 19/19                               |
| "Seeders idempotentes en cada servicio" | Solo finance lo era (corregido)     |

### 4.5 Detalle de diseño

- `invoices` y `bank_accounts` tienen `deleted_at` (soft delete); `transactions` no. Es una decisión razonable: una transacción bancaria no se borra, se compensa.
- `audit_logs` es append-only real: no se puede corregir un registro, solo agregar otro. Correcto para auditoría, pero implica que el seed no puede limpiarse y debe ser guardado por lectura.

---

## 5. Conclusión

El esquema cumple el DoD del issue #4:

- Montos en unidades menores `BIGINT` (ADR-003) ✅
- Idempotencia estricta por tenant ✅
- Inmutabilidad de auditoría a nivel de motor ✅
- pgvector con índice HNSW cosine ✅
- Migraciones independientes y ledger de Drizzle ✅
- Seeders idempotentes ✅ (tras la corrección)

**Veredicto: aprobado para merge.** Los puntos de §4 son follow-ups, no bloqueantes.
