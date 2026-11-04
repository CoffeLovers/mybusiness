import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES, QueueMetricsService, dlqName } from '@mybusiness/common';

type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const QUEUE_COUNTS: Record<string, number> = {
  active: 1,
  completed: 2,
  failed: 0,
  delayed: 3,
  waiting: 4,
  waiting_children: 0,
};

// Valores distintos para verificar que la DLQ suma `waiting + delayed` (10 + 5 = 15).
const DLQ_COUNTS: Record<string, number> = { waiting: 10, delayed: 5 };

const QUEUE_LIST = Object.values(QUEUE_NAMES) as QueueName[];

function createQueueMock(counts: Record<string, number> = QUEUE_COUNTS): Queue {
  return {
    getJobCounts: vi.fn(async (..._keys: string[]) => ({ ...counts })),
  } as unknown as Queue;
}

function createRecords(factory: () => Queue = () => createQueueMock()): Record<QueueName, Queue> {
  return Object.fromEntries(QUEUE_LIST.map((name) => [name, factory()])) as Record<
    QueueName,
    Queue
  >;
}

describe('QueueMetricsService', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('snapshot() devuelve las 4 colas con sus contadores y la suma de la DLQ', async () => {
    const records = createRecords();
    const dlqRecords = createRecords(() => createQueueMock(DLQ_COUNTS));

    const snapshot = await new QueueMetricsService(records, dlqRecords).snapshot();

    expect(Object.keys(snapshot)).toEqual(QUEUE_LIST);

    for (const name of QUEUE_LIST) {
      expect(snapshot[name], dlqName(name)).toEqual({
        active: 1,
        completed: 2,
        failed: 0,
        delayed: 3,
        waiting: 4,
        dlq: 15,
      });
    }
  });

  it('health() devuelve true cuando todas las colas responden', async () => {
    const service = new QueueMetricsService(createRecords(), createRecords());

    await expect(service.health()).resolves.toBe(true);
  });

  it('health() devuelve false cuando una cola rechaza', async () => {
    const records = createRecords();
    records[QUEUE_NAMES.OCR] = {
      getJobCounts: vi.fn(
        () =>
          new Promise<Record<string, number>>((_resolve, reject) => {
            setTimeout(() => reject(new Error('down')), 10);
          }),
      ),
    } as unknown as Queue;

    await expect(new QueueMetricsService(records, createRecords()).health()).resolves.toBe(false);
  });

  it('health() devuelve false cuando una cola tarda más de 2 s', async () => {
    vi.useFakeTimers();

    const records = createRecords();
    records[QUEUE_NAMES.OCR] = {
      getJobCounts: vi.fn(
        () =>
          new Promise<Record<string, number>>((resolve) => {
            setTimeout(() => resolve({ waiting: 1 }), 2_500);
          }),
      ),
    } as unknown as Queue;

    const health = new QueueMetricsService(records, createRecords()).health();

    await vi.advanceTimersByTimeAsync(2_001);

    await expect(health).resolves.toBe(false);
  });
});
