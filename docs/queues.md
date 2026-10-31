# Colas durables — BullMQ (SF2-06)

> Infraestructura común en `@mybusiness/common/src/queues`. No incluye jobs de negocio.

## Por qué BullMQ

Redis Pub/Sub (transporte RPC/eventos) es _at-most-once_: si el consumidor está caído, el evento se pierde. BullMQ añade persistencia, reintentos con backoff, concurrencia y DLQ sobre el mismo Redis autenticado (ADR-002).

## Colas

| Cola             | Uso previsto                              | DLQ                  |
| ---------------- | ----------------------------------------- | -------------------- |
| `banking-sync`   | Sincronización incremental de agregadores | `banking-sync-dlq`   |
| `ocr`            | Extracción de datos de facturas           | `ocr-dlq`            |
| `reconciliation` | Conciliación bancaria                     | `reconciliation-dlq` |
| `notifications`  | Envío de notificaciones                   | `notifications-dlq`  |

## Contrato

```ts
import {
  QUEUE_NAMES,
  buildJobId,
  createQueue,
  createWorker,
  BullMQModule,
  QueueMetricsService,
} from '@mybusiness/common';

const jobId = buildJobId(QUEUE_NAMES.OCR, `invoice:${invoiceId}`);
await queue.add('extract', { invoiceId }, { jobId });
```

- **Idempotencia**: `buildJobId(cola, clave)` produce un SHA-256 de 32 caracteres; BullMQ ignora un `jobId` repetido.
- **Reintentos**: `attempts: 5` con backoff exponencial de 2 s (`DEFAULT_JOB_OPTIONS`).
- **DLQ**: cuando un job agota sus intentos, el worker lo copia a `<cola>-dlq` con `failedReason` y `originalJobId`.
- **Concurrencia**: `QUEUE_CONCURRENCY_<COLA>` > `QUEUE_CONCURRENCY` > 5 (rango 1-50).
- **Apagado**: `drainAndClose` espera los jobs en curso hasta `QUEUE_SHUTDOWN_TIMEOUT_MS` (por defecto 30 s) y nunca lanza.

## Métricas

`QueueMetricsService.snapshot()` devuelve por cola `active`, `completed`, `failed`, `delayed`, `waiting` y `dlq`. `health()` comprueba que todas las colas responden en menos de 2 s.

## Módulo Nest

```ts
@Module({ imports: [BullMQModule.forRoot()] })
export class AppModule {}
```

Los tokens `queueToken(name)` y `dlqToken(name)` permiten inyectar cada cola. Cada servicio registra sus workers con `registerWorker()` para que el apagado ordenado los espere.

## Pruebas

```bash
pnpm --filter @mybusiness/finance-service test      # utilidades (sin Redis)
pnpm --filter @mybusiness/finance-service test:e2e  # integración con Redis (reintento, DLQ, idempotencia, shutdown)
```

En CI, el servicio Redis del job `test-e2e` arranca con `--requirepass test_password`.

## Límites conocidos

- Sin panel de administración (Bull Board) ni alertas; las métricas se exponen por código.
- Sin prioridades por tenant: la concurrencia es global por cola.
- Los jobs completados se conservan 24 h (máximo 1 000) y los fallidos 7 días.
