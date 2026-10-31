import { Logger } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';

import { getBullMQConnectionOptions, type ConfigReader } from '../redis/redis.config';
import {
  DEFAULT_JOB_OPTIONS,
  dlqName,
  resolveConcurrency,
  resolveShutdownTimeoutMs,
  type QueueName,
} from './queues';

const logger = new Logger('QueueFactory');

/**
 * Colas DLQ creadas de forma perezosa: sólo se instancia una conexión si un job agota sus reintentos.
 */
const dlqQueues = new Map<string, Queue>();

function getDlqQueue(name: QueueName, config?: ConfigReader): Queue {
  const nameForDlq = dlqName(name);
  const existing = dlqQueues.get(nameForDlq);
  if (existing) {
    return existing;
  }

  const created = new Queue(nameForDlq, {
    connection: getBullMQConnectionOptions(config),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  dlqQueues.set(nameForDlq, created);
  return created;
}

/**
 * Cierra todas las conexiones DLQ abiertas. Seguro de invocar varias veces.
 */
export async function closeDlqQueues(): Promise<void> {
  const pending = [...dlqQueues.values()];
  dlqQueues.clear();

  await Promise.all(
    pending.map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to close DLQ queue "${queue.name}": ${message}`);
      }
    }),
  );
}

export function createQueue(name: QueueName, config?: ConfigReader): Queue {
  return new Queue(name, {
    connection: getBullMQConnectionOptions(config),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export type QueueJobHandler = (job: Job) => Promise<unknown>;

/**
 * Crea un worker con concurrencia resuelta por entorno y transferencia automática a la DLQ
 * cuando el job agota sus intentos.
 *
 * Nunca se registra `job.data`: puede contener datos financieros sensibles.
 */
export function createWorker(
  name: QueueName,
  handler: QueueJobHandler,
  options?: { concurrency?: number; config?: ConfigReader },
): Worker {
  const worker = new Worker(name, handler, {
    connection: getBullMQConnectionOptions(options?.config),
    concurrency: options?.concurrency ?? resolveConcurrency(name),
  });

  worker.on('failed', (job, error) => {
    if (!job) {
      logger.warn(`Job failed in queue "${name}" without job context: ${error.message}`);
      return;
    }

    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts;
    if (job.attemptsMade < maxAttempts) {
      logger.warn(
        `Job ${job.id} ("${job.name}") failed attempt ${job.attemptsMade}/${maxAttempts} in queue "${name}": ${error.message}`,
      );
      return;
    }

    logger.error(
      `Job ${job.id} ("${job.name}") exhausted ${maxAttempts} attempts in queue "${name}": ${error.message}. Moving to DLQ.`,
    );

    void getDlqQueue(name, options?.config)
      .add(
        name,
        {
          ...job.data,
          failedReason: error.message,
          originalJobId: job.id,
        },
        { jobId: `${job.id}-dlq` },
      )
      .catch((dlqError: unknown) => {
        const message = dlqError instanceof Error ? dlqError.message : String(dlqError);
        logger.error(`Failed to enqueue job ${job.id} into DLQ "${dlqName(name)}": ${message}`);
      });
  });

  return worker;
}

/**
 * Cierre ordenado de workers y colas con límite de tiempo.
 * Nunca lanza: un shutdown debe completarse aunque Redis no responda.
 */
export async function drainAndClose(
  workers: Worker[],
  queues: Queue[],
  timeoutMs = resolveShutdownTimeoutMs(),
): Promise<void> {
  if (workers.length === 0 && queues.length === 0) {
    return;
  }

  let timer: NodeJS.Timeout | undefined;

  try {
    const closing = Promise.all([
      ...queues.map((queue) => queue.close()),
      ...workers.map((worker) => worker.close()),
    ])
      .then(() => true)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error while closing BullMQ resources: ${message}`);
        return true;
      });

    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });

    const closedInTime = await Promise.race([closing, timeout]);
    if (!closedInTime) {
      logger.warn(
        `BullMQ shutdown exceeded ${timeoutMs}ms; continuing without waiting for remaining connections`,
      );
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
