# Webhooks bancarios firmados e idempotentes (SF2-05)

> Implementación Plaid sobre BullMQ (`banking-sync`). Belvo permanece fail-closed
> como deuda heredada de SF2-04.

## Flujo

1. El gateway expone `POST /api/v1/webhooks/plaid` con body crudo y reenvía el RPC
   `banking.webhook.handle` a finance-service.
2. `PlaidAdapter.handleWebhook` verifica `Plaid-Verification` (JWT ES256 + hash del
   body). Cualquier fallo lanza 401 y **no** persiste ni encola nada.
3. `BankingWebhookService` deduplica por `UNIQUE(provider, provider_event_key)`.
   Un duplicado responde 200 sin reprocesar; si quedó en `received` por un fallo
   previo de encolado, reintenta publicar el job con el mismo `jobId`.
4. El evento se inserta como `received` con `occurred_at` (payload o `iat` del JWT).
5. Los eventos no accionables o sin conexión asociada se cierran como `ignored`.
6. Los eventos accionables se encolan en `banking-sync` con un `jobId`
   determinista (`buildJobId`) y el request responde de inmediato.
7. `BankingWebhookWorker` consume la cola y `BankingWebhookProcessor`:
   - descarta eventos más antiguos que el último `processed` de la misma conexión
     (`occurredAt`) salvo `force=true`;
   - ejecuta `internalSyncConnection`;
   - marca `processed` o `failed` y relanza en fallo para que BullMQ aplique
     backoff exponencial (5 intentos) y mueva a `banking-sync-dlq`.

## Estados

| Estado DB   | Equivalente issue | Significado                                          |
| ----------- | ----------------- | ---------------------------------------------------- |
| `received`  | `RECEIVED`        | Persistido y encolado, pendiente de worker.          |
| `processed` | `PROCESSED`       | Sincronización aplicada correctamente.               |
| `ignored`   | `IGNORED`         | No accionable, sin conexión o descartado por orden.  |
| `failed`    | `FAILED`          | Falló el encolado o el procesamiento; admite replay. |

## Replay manual

`POST /api/v1/webhooks/:id/replay` (JWT) → RPC `banking.webhook.replay`.

- Sólo eventos `failed` o `ignored`.
- `ignored` requiere `{ "force": true }` y además debe haber sido descartado por
  orden (`error_message = evento_fuera_de_orden`). Eventos no accionables no son
  reprocesables.
- El tenant se valida resolviendo `connection_id → bank_connections.tenant_id`.
  Eventos de otro tenant responden 404.
- Incrementa `replay_count`, reencola con un `jobId` nuevo y publica
  `audit.log_event` con acción `banking.webhook.replay` (estado anterior/nuevo,
  usuario, tenant y `force`).

## Sincronización por cuenta

`bank_accounts.last_synced_at` se actualiza al sincronizar cuentas y al completar
un lote de transacciones. Se expone como `lastSyncedAt` en `BankAccountResponse`.

## Migración

`apps/finance-service/drizzle/0004_yielding_pride.sql`:

- `bank_webhook_events.processing_status` default `received` y backfill
  `pending → received`.
- Nuevas columnas `occurred_at`, `attempts`, `replay_count`.
- Backfill `occurred_at = received_at` para eventos históricos.
- `bank_accounts.last_synced_at`.
- Índice `(connection_id, occurred_at)` para la guardia de orden.

## Pruebas

```bash
pnpm --filter @mybusiness/finance-service test
pnpm --filter @mybusiness/api-gateway test
```

Cubren firma inválida, dedupe, eventos ignorados, fallo de encolado, guardia de
orden, `force`, reintentos (relanzado para BullMQ), replay por estado/tenant y
auditoría.

## Operación

- DLQ: `banking-sync-dlq` (creada por `createWorker` al agotar intentos).
- Concurrencia: `QUEUE_CONCURRENCY_BANKING_SYNC` o `QUEUE_CONCURRENCY` (1–50).
- Shutdown: `QUEUE_SHUTDOWN_TIMEOUT_MS`.
- Si Redis no está disponible, el webhook responde 503 y el evento queda
  `failed` para replay manual.
