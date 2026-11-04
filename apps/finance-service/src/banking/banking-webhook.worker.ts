import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { BankWebhookJobData } from '@mybusiness/contracts';
import {
  QUEUE_NAMES,
  createWorker,
  drainAndClose,
  registerWorker,
  resolveConcurrency,
} from '@mybusiness/common';
import { BankingWebhookProcessor } from './banking-webhook.processor';

/**
 * Consumidor BullMQ de la cola `banking-sync` para eventos webhook.
 *
 * Nunca registra `job.data`: sólo metadatos de la cola y el número de fallos
 * gestionado por el propio worker de `@mybusiness/common`.
 */
@Injectable()
export class BankingWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BankingWebhookWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly processor: BankingWebhookProcessor,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const concurrency = resolveConcurrency(QUEUE_NAMES.BANKING_SYNC);

    this.worker = createWorker(
      QUEUE_NAMES.BANKING_SYNC,
      async (job) => this.processor.process(job.data as BankWebhookJobData),
      { config: this.config, concurrency },
    );

    registerWorker(this.worker);
    this.logger.log(`Worker banking-sync iniciado con concurrencia ${concurrency}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      await drainAndClose([this.worker], []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo cerrar el worker banking-sync: ${message}`);
    }
  }
}
