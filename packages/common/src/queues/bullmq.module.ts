import {
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import type { Queue, Worker } from 'bullmq';

import type { ConfigReader } from '../redis/redis.config';
import { closeDlqQueues, createQueue, drainAndClose } from './queue.factory';
import { QueueMetricsService } from './queue-metrics.service';
import { ALL_QUEUE_NAMES, dlqName, type QueueName } from './queues';

const TOKEN_PREFIX = 'BULLMQ_QUEUE_';
const DLQ_TOKEN_PREFIX = 'BULLMQ_DLQ_';

function tokenSuffix(name: QueueName): string {
  return name.toUpperCase().replace(/-/g, '_');
}

export function queueToken(name: QueueName): string {
  return `${TOKEN_PREFIX}${tokenSuffix(name)}`;
}

export function dlqToken(name: QueueName): string {
  return `${DLQ_TOKEN_PREFIX}${tokenSuffix(name)}`;
}

/**
 * Registro compartido de workers activos. Cada servicio que cree workers debe registrarlos
 * para que el shutdown ordenado los drene.
 */
const registeredWorkers: Worker[] = [];

export function registerWorker(worker: Worker): void {
  if (!registeredWorkers.includes(worker)) {
    registeredWorkers.push(worker);
  }
}

@Injectable()
export class QueueShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueShutdownService.name);

  constructor(
    private readonly queues: Queue[],
    private readonly dlqQueues: Queue[],
  ) {}

  registerWorker(worker: Worker): void {
    registerWorker(worker);
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log(
      `Draining ${registeredWorkers.length} worker(s) and ${this.queues.length} queue(s)`,
    );

    await drainAndClose(registeredWorkers, [...this.queues, ...this.dlqQueues]);
    await closeDlqQueues();
  }
}

export interface BullMQModuleOptions {
  queues?: readonly QueueName[];
  config?: ConfigReader;
}

@Module({})
export class BullMQModule {
  static forRoot(options?: BullMQModuleOptions): DynamicModule {
    const names: readonly QueueName[] = options?.queues ?? ALL_QUEUE_NAMES;
    const config = options?.config;

    const queueProviders: Provider[] = names.map((name) => ({
      provide: queueToken(name),
      useFactory: () => createQueue(name, config),
    }));

    const dlqProviders: Provider[] = names.map((name) => ({
      provide: dlqToken(name),
      useFactory: () => createQueue(dlqName(name) as QueueName, config),
    }));

    const queueTokens = names.map(queueToken);
    const dlqTokens = names.map(dlqToken);

    const metricsProvider: Provider = {
      provide: QueueMetricsService,
      useFactory: (...instances: Queue[]) => {
        const queues = {} as Record<QueueName, Queue>;
        const dlqs = {} as Record<QueueName, Queue>;

        names.forEach((name, index) => {
          queues[name] = instances[index];
          dlqs[name] = instances[names.length + index];
        });

        return new QueueMetricsService(queues, dlqs);
      },
      inject: [...queueTokens, ...dlqTokens],
    };

    const shutdownProvider: Provider = {
      provide: QueueShutdownService,
      useFactory: (...instances: Queue[]) => {
        const queues = instances.slice(0, names.length);
        const dlqs = instances.slice(names.length);
        return new QueueShutdownService(queues, dlqs);
      },
      inject: [...queueTokens, ...dlqTokens],
    };

    return {
      module: BullMQModule,
      providers: [...queueProviders, ...dlqProviders, metricsProvider, shutdownProvider],
      exports: [...queueTokens, ...dlqTokens, QueueMetricsService, QueueShutdownService],
    };
  }
}
