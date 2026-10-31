import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { DocumentOcrJobData } from '@mybusiness/contracts';
import {
  QUEUE_NAMES,
  createWorker,
  drainAndClose,
  registerWorker,
  resolveConcurrency,
} from '@mybusiness/common';
import { DocumentsService } from './documents.service';

/**
 * Consumidor BullMQ de la cola de OCR.
 *
 * Nunca registra `job.data`: sólo metadatos de la cola y el número de fallos
 * gestionado por el propio worker de `@mybusiness/common`.
 */
@Injectable()
export class DocumentsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentsWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const concurrency = resolveConcurrency(QUEUE_NAMES.OCR);

    this.worker = createWorker(
      QUEUE_NAMES.OCR,
      async (job) => this.documentsService.processOcr(job.data as DocumentOcrJobData),
      { config: this.config, concurrency },
    );

    registerWorker(this.worker);
    this.logger.log(`Worker OCR iniciado con concurrencia ${concurrency}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      await drainAndClose([this.worker], []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo cerrar el worker OCR: ${message}`);
    }
  }
}
