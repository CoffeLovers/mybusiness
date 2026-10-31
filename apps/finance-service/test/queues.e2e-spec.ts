import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Queue, Worker, type Job } from 'bullmq';
import { createWorker, drainAndClose, getBullMQConnectionOptions } from '@mybusiness/common';

const describeIfRedis = process.env.REDIS_HOST ? describe : describe.skip;

const POLL_INTERVAL_MS = 25;
const MAX_POLL_ATTEMPTS = 400;

type JobData = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => Promise<boolean>, description: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timeout esperando: ${description}`);
}

describeIfRedis('Colas BullMQ (integración con Redis)', () => {
  const connection = getBullMQConnectionOptions();

  let queue: Queue<JobData>;
  let dlqQueue: Queue<JobData>;
  let worker: Worker | undefined;

  beforeEach(async () => {
    queue = new Queue<JobData>('ocr', {
      connection,
      defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 10 } },
    });
    dlqQueue = new Queue<JobData>('ocr-dlq', { connection });

    await queue.obliterate({ force: true });
    await dlqQueue.obliterate({ force: true });
  });

  afterEach(async () => {
    if (worker) {
      try {
        await worker.close();
      } catch {
        /* el worker ya estaba cerrado */
      }
      worker = undefined;
    }

    await queue.close();
    await dlqQueue.close();
  });

  afterAll(async () => {
    await drainAndClose([], [queue, dlqQueue]);
  });

  it('reintenta y mueve el job agotado a la DLQ', async () => {
    worker = createWorker('ocr', async () => {
      throw new Error('boom');
    });

    const job = await queue.add('ocr', { tenantId: 'tenant-1' });
    const originalJobId = job.id;
    expect(originalJobId).toBeDefined();

    await waitFor(
      async () => (await queue.getJobCounts('failed')).failed === 1,
      'el job agote sus intentos y quede en failed',
    );

    await waitFor(async () => {
      const counts = await dlqQueue.getJobCounts('waiting', 'delayed');
      return (counts.waiting ?? 0) + (counts.delayed ?? 0) === 1;
    }, 'el job llegue a la DLQ');

    const [dlqJob] = (await dlqQueue.getJobs(['waiting', 'delayed'])) as Job<JobData>[];

    expect(dlqJob).toBeDefined();
    expect(dlqJob.data.originalJobId).toBe(originalJobId);
    expect(String(dlqJob.data.failedReason)).toContain('boom');
  });

  it('es idempotente ante el mismo jobId', async () => {
    await queue.add('sync', { a: 1 }, { jobId: 'fixed-1' });
    await queue.add('sync', { a: 1 }, { jobId: 'fixed-1' });

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    expect(total).toBe(1);
  });

  it('persiste el job tras reiniciar la conexión de la cola', async () => {
    await queue.add('sync', { b: 2 }, { jobId: 'persist-1' });
    await queue.close();

    queue = new Queue<JobData>('ocr', { connection });

    const job = await queue.getJob('persist-1');

    expect(job).toBeDefined();
    expect(await job?.getState()).toBe('waiting');
  });

  it('cierra el worker esperando a que el job en curso termine', async () => {
    worker = createWorker('ocr', async () => {
      await sleep(300);
    });

    const job = await queue.add('sync', { c: 3 });
    const jobId = job.id;

    await waitFor(
      async () => (await (await queue.getJob(jobId ?? ''))?.getState()) === 'active',
      'el job esté en curso',
    );

    const started = Date.now();
    await drainAndClose([worker], [queue], 5_000);
    worker = undefined;

    expect(Date.now() - started).toBeGreaterThanOrEqual(250);

    queue = new Queue<JobData>('ocr', { connection });
    const finished = await queue.getJob(jobId ?? '');

    expect(finished).toBeDefined();
    expect(await finished?.getState()).toBe('completed');
  });
});
