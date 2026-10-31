import { createHash } from 'node:crypto';

/**
 * Nombres canónicos de las colas asíncronas de la plataforma.
 * Se usan como claves de Redis en BullMQ; no deben renombrarse sin migrar los jobs pendientes.
 */
export const QUEUE_NAMES = {
  BANKING_SYNC: 'banking-sync',
  OCR: 'ocr',
  RECONCILIATION: 'reconciliation',
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUE_NAMES);

/**
 * Payload genérico de un job. Cada cola define su propio contrato en `@mybusiness/contracts`.
 */
export interface QueueJobData {
  [key: string]: unknown;
}

export interface QueueJobOptions {
  jobId: string;
  attempts?: number;
  priority?: number;
}

/**
 * Reintentos exponenciales con retención acotada para evitar crecimiento ilimitado de Redis.
 * `as const` preserva los literales que exige `DefaultJobOptions` de BullMQ.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export const DLQ_SUFFIX = '-dlq';

export function dlqName(queue: QueueName): string {
  return `${queue}${DLQ_SUFFIX}`;
}

/**
 * Idempotencia: el `jobId` deriva del nombre de cola y de una clave de negocio,
 * de modo que reintentos del publicador no generen jobs duplicados.
 */
export function buildJobId(queue: QueueName, key: string): string {
  if (!key || key.trim().length === 0) {
    throw new Error(`buildJobId requires a non-empty key for queue "${queue}"`);
  }
  return createHash('sha256').update(`${queue}:${key}`).digest('hex').slice(0, 32);
}

const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 50;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;
const MIN_SHUTDOWN_TIMEOUT_MS = 1_000;
const MAX_SHUTDOWN_TIMEOUT_MS = 300_000;

function envKeyForQueue(queue: QueueName): string {
  return `QUEUE_CONCURRENCY_${queue.toUpperCase().replace(/-/g, '_')}`;
}

function parseBoundedInt(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolución de concurrencia por cola con override global.
 * Orden: `QUEUE_CONCURRENCY_<QUEUE>` → `QUEUE_CONCURRENCY` → 5 (rango válido 1–50).
 */
export function resolveConcurrency(queue: QueueName, env: NodeJS.ProcessEnv = process.env): number {
  return (
    parseBoundedInt(readEnv(env, envKeyForQueue(queue)), MIN_CONCURRENCY, MAX_CONCURRENCY) ??
    parseBoundedInt(readEnv(env, 'QUEUE_CONCURRENCY'), MIN_CONCURRENCY, MAX_CONCURRENCY) ??
    DEFAULT_CONCURRENCY
  );
}

/**
 * Tiempo máximo de espera para cerrar workers y colas durante el shutdown (rango 1s–300s).
 */
export function resolveShutdownTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return (
    parseBoundedInt(
      readEnv(env, 'QUEUE_SHUTDOWN_TIMEOUT_MS'),
      MIN_SHUTDOWN_TIMEOUT_MS,
      MAX_SHUTDOWN_TIMEOUT_MS,
    ) ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  );
}
