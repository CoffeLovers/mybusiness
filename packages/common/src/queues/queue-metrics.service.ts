import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { QueueName } from './queues';

export interface QueueMetricsSnapshot {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
  dlq: number;
}

const HEALTH_TIMEOUT_MS = 2_000;

/**
 * Métricas operativas de las colas y sus DLQ, para healthchecks y dashboards.
 */
@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);

  constructor(
    private readonly queues: Record<QueueName, Queue>,
    private readonly dlqQueues: Record<QueueName, Queue>,
  ) {}

  async snapshot(): Promise<Record<QueueName, QueueMetricsSnapshot>> {
    const entries = await Promise.all(
      (Object.keys(this.queues) as QueueName[]).map(async (name) => {
        const queue = this.queues[name];
        const dlq = this.dlqQueues[name];

        const [counts, dlqCounts] = await Promise.all([
          queue.getJobCounts('active', 'completed', 'failed', 'delayed', 'waiting'),
          dlq.getJobCounts('waiting', 'delayed'),
        ]);

        const snapshot: QueueMetricsSnapshot = {
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          waiting: counts.waiting ?? 0,
          dlq: (dlqCounts.waiting ?? 0) + (dlqCounts.delayed ?? 0),
        };

        return [name, snapshot] as const;
      }),
    );

    return Object.fromEntries(entries) as Record<QueueName, QueueMetricsSnapshot>;
  }

  /**
   * `true` si todas las colas responden a Redis dentro de 2 s.
   */
  async health(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    try {
      const probe = Promise.all(
        Object.values(this.queues).map((queue) => queue.getJobCounts('waiting')),
      )
        .then(() => true)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Queue health probe failed: ${message}`);
          return false;
        });

      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
      });

      return await Promise.race([probe, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
