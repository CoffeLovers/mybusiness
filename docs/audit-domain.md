# Auditoría append-only — `audit-service`

> Implementado en la issue #15. Consumidor asíncrono de eventos con bitácora inmutable.

## Modelo

`audit_logs` guarda `tenantId`, `userId`, `eventId`, `action`, `entityName`, `entityId`, `oldValues`, `newValues`, `ipAddress`, `userAgent` y `timestamp`. `audit_dead_letters` guarda eventos que fallaron tras los reintentos.

## Invariantes

1. **Append-only real.** La migración `0000` instala triggers que abortan `UPDATE` y `DELETE` sobre `audit_logs`; la migración `0001` añade la protección de `TRUNCATE`. El repositorio no expone operaciones de mutación.
2. **Idempotencia atómica.** `UNIQUE (tenant_id, event_id)` + `INSERT ... ON CONFLICT DO NOTHING`. Una reentrega devuelve el registro existente con `duplicate: true`.
3. **Aislamiento por tenant.** Toda consulta filtra por `tenantId`; el mismo `eventId` puede existir en tenants distintos.
4. **Contrato estricto.** `eventId` es obligatorio en `CreateAuditLogEvent`; el gateway lo genera con `randomUUID()`.
5. **Tolerancia a fallos.** El consumidor reintenta 3 veces con backoff lineal (50 ms × intento); si persiste, escribe en `audit_dead_letters` y no propaga el error al broker.

## Eventos consumidos

| Patrón                        | Origen                  | Acción registrada             |
| ----------------------------- | ----------------------- | ----------------------------- |
| `audit.log_event`             | API Gateway (seguridad) | `SECURITY_<status>_<method>`  |
| `finance.transaction.created` | finance-service         | `finance.transaction.created` |
| `finance.invoice.paid`        | finance-service         | `finance.invoice.paid`        |

## Pruebas

```bash
pnpm --filter @mybusiness/audit-service test      # unitarios
pnpm --filter @mybusiness/audit-service test:e2e  # requiere AUDIT_DATABASE_URL
```

La e2e verifica idempotencia, aislamiento, cuarentena y que el trigger bloquea mutaciones. En CI el job `test-e2e` levanta PostgreSQL en 5434 y aplica migraciones.

## Límites conocidos

- Redis Pub/Sub es _at-most-once_: si el proceso muere antes de persistir, el evento se pierde. La entrega durable llega con BullMQ (SF2-06).
- `TRUNCATE` se bloquea con trigger, pero un administrador con privilegios de DDL puede desinstalarlo; la protección es operativa y de mínimo privilegio.
