# Dominio financiero — `finance-service`

> Implementado en la issue #13. Sustituye la persistencia en memoria por PostgreSQL con Drizzle ORM.

## Modelo

| Tabla           | Propósito                     | Restricciones clave                                       |
| --------------- | ----------------------------- | --------------------------------------------------------- |
| `bank_accounts` | Cuentas bancarias del tenant  | `tenant_id`, `deleted_at`; saldos en `BIGINT`             |
| `transactions`  | Movimientos financieros       | `UNIQUE (tenant_id, idempotency_key)`; FK a cuenta        |
| `invoices`      | Facturas emitidas o recibidas | `UNIQUE (tenant_id, invoice_number)`; totales en `BIGINT` |

Los importes se almacenan como enteros en la unidad mínima (`*_minor`) y se serializan como `string` en las respuestas, conforme a [ADR-003](adr/003-dinero.md). Los DTOs y patrones viven en `@mybusiness/contracts` ([ADR-004](adr/004-contratos.md)).

## Invariantes

1. **Aislamiento por tenant.** Toda consulta del repositorio filtra por `tenantId`. Ningún método acepta un tenant distinto al del contexto RPC.
2. **Idempotencia de transacciones.** `INSERT ... ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`; si no inserta, se devuelve la transacción existente. Un reintento no duplica ni falla. Si llega la misma `idempotencyKey` con un payload distinto, se devuelve la transacción original y se ignora el nuevo contenido; la key es la identidad de la operación.
3. **Precisión monetaria.** Se convierte `string` a `BigInt` con validación `^\d+$`; nunca se usa `number` para dinero.
4. **Integridad de factura.** `subtotalMinor + taxAmountMinor === totalAmountMinor`; en caso contrario, 400.
5. **Moneda consistente.** Una transacción debe usar la misma moneda que su cuenta; en caso contrario, 400.
6. **Pago de factura.** Sólo transicionan a `PAID` facturas en `DRAFT`, `ISSUED` u `OVERDUE`. Un segundo pago devuelve la factura sin emitir un evento nuevo.
7. **Auditoría por evento.** Cada transacción creada y cada factura pagada emiten un evento de dominio.

## Operaciones RPC

| Patrón                        | Método              | Errores esperados                                      |
| ----------------------------- | ------------------- | ------------------------------------------------------ |
| `finance.accounts.get`        | `getAccounts`       | 400 sin `tenantId`                                     |
| `finance.accounts.create`     | `createAccount`     | 400 importe inválido                                   |
| `finance.transactions.get`    | `getTransactions`   | 400 sin `tenantId`                                     |
| `finance.transactions.create` | `createTransaction` | 404 cuenta, 400 moneda/importe, 400 sin idempotencyKey |
| `finance.invoices.get`        | `getInvoices`       | 400 sin `tenantId`                                     |
| `finance.invoices.create`     | `createInvoice`     | 400 totales/fecha, 409 número duplicado                |
| `finance.invoices.pay`        | `payInvoice`        | 404 factura/transacción, 409 factura cancelada         |

El gateway expone `POST /api/v1/finance/invoices/pay` con roles `ACCOUNTANT`, `TENANT_ADMIN` y `SUPER_ADMIN`.

## Eventos

| Evento                    | Patrón                        | Cuándo se emite                       |
| ------------------------- | ----------------------------- | ------------------------------------- |
| `TransactionCreatedEvent` | `finance.transaction.created` | Sólo en la primera inserción efectiva |
| `InvoicePaidEvent`        | `finance.invoice.paid`        | Sólo en la transición a `PAID`        |

Los payloads están tipados en `packages/contracts/src/dtos/finance.dto.ts` e incluyen `eventId`, `tenantId`, identificadores y `occurredAt`.

**Limitación conocida:** la publicación es _best-effort_ sobre Redis Pub/Sub después del commit. Si el bus está caído, la operación financiera persiste pero el evento se pierde. La entrega durable (outbox o BullMQ) corresponde a la issue #15.

## Pruebas

```bash
pnpm --filter @mybusiness/finance-service test      # unitarios con mocks, sin base de datos
pnpm --filter @mybusiness/finance-service test:e2e  # integración con PostgreSQL real
```

La suite e2e se omite si `FINANCE_DATABASE_URL` no está definida. Para ejecutarla en local sobre una base aislada:

```bash
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" mybusiness_postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE finance_test OWNER finance_user;"
FINANCE_DATABASE_URL="postgresql://finance_user:<password>@localhost:<puerto>/finance_test" \
  pnpm --filter @mybusiness/finance-service db:migrate
FINANCE_DATABASE_URL="postgresql://finance_user:<password>@localhost:<puerto>/finance_test" \
  pnpm --filter @mybusiness/finance-service test:e2e
```

En CI, el job `test-e2e` levanta PostgreSQL 16, aplica las migraciones y ejecuta la suite.

## Límites conocidos y siguientes pasos

- Listados limitados a 200 registros y sin paginación; se resolverá con la tabla densa de Fase 2 (SF2-09).
- Sin _outbox_ transaccional: ver issue #15.
- Sin conciliación ni OCR: Fase 2.
- La base local `finance_db` puede presentar drift si se creó con `db:push`; usar una base limpia y `db:migrate` para pruebas.
