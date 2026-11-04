import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { BankWebhookProcessingStatus, type BankWebhookJobData } from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import { bankWebhookEvents } from '../database/schema';
import { BankingService } from './banking.service';

/**
 * Procesa los jobs de la cola `banking-sync` originados por webhooks.
 *
 * - Guardia de orden: un evento más antiguo que el último `processed` de la
 *   misma conexión se marca `ignored` y no retrocede el estado de la cuenta.
 * - En fallo marca `failed` y relanza para que BullMQ aplique backoff y DLQ.
 */
@Injectable()
export class BankingWebhookProcessor {
  private readonly logger = new Logger(BankingWebhookProcessor.name);

  constructor(
    private readonly databaseService: FinanceDatabaseService,
    private readonly bankingService: BankingService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  async process(data: BankWebhookJobData): Promise<void> {
    const [event] = await this.db
      .select()
      .from(bankWebhookEvents)
      .where(eq(bankWebhookEvents.id, data.eventId))
      .limit(1);

    if (!event) {
      this.logger.warn(`Evento de webhook ${data.eventId} no encontrado; job descartado.`);
      return;
    }

    // Idempotencia: un replay o reintento sobre un evento ya procesado no vuelve a sincronizar.
    if (event.processingStatus === BankWebhookProcessingStatus.PROCESSED) {
      return;
    }

    if (event.processingStatus === BankWebhookProcessingStatus.IGNORED && !data.force) {
      return;
    }

    if (!event.connectionId) {
      await this.markIgnored(event.id, 'conexion_no_encontrada');
      return;
    }

    if (!data.force && (await this.hasNewerProcessedEvent(event.connectionId, event))) {
      this.logger.warn(
        `Evento ${event.id} descartado por orden: ya existe un evento processed más reciente.`,
      );
      await this.markIgnored(event.id, 'evento_fuera_de_orden');
      return;
    }

    await this.db
      .update(bankWebhookEvents)
      .set({ attempts: sql`${bankWebhookEvents.attempts} + 1` })
      .where(eq(bankWebhookEvents.id, event.id));

    try {
      await this.bankingService.internalSyncConnection(event.connectionId);

      await this.db
        .update(bankWebhookEvents)
        .set({
          processingStatus: BankWebhookProcessingStatus.PROCESSED,
          errorMessage: null,
          processedAt: new Date(),
        })
        .where(eq(bankWebhookEvents.id, event.id));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al procesar webhook';

      await this.db
        .update(bankWebhookEvents)
        .set({
          processingStatus: BankWebhookProcessingStatus.FAILED,
          errorMessage: message,
          processedAt: new Date(),
        })
        .where(eq(bankWebhookEvents.id, event.id));

      // Relanzar permite que BullMQ reintente con backoff y, agotados los intentos, mueva a DLQ.
      throw error;
    }
  }

  private async hasNewerProcessedEvent(
    connectionId: string,
    event: { occurredAt: Date | null; receivedAt: Date },
  ): Promise<boolean> {
    const occurredAt = event.occurredAt ?? event.receivedAt;

    const [newer] = await this.db
      .select({ id: bankWebhookEvents.id })
      .from(bankWebhookEvents)
      .where(
        and(
          eq(bankWebhookEvents.connectionId, connectionId),
          eq(bankWebhookEvents.processingStatus, BankWebhookProcessingStatus.PROCESSED),
          gt(bankWebhookEvents.occurredAt, occurredAt),
        ),
      )
      .limit(1);

    return Boolean(newer);
  }

  private async markIgnored(eventId: string, reason: string): Promise<void> {
    await this.db
      .update(bankWebhookEvents)
      .set({
        processingStatus: BankWebhookProcessingStatus.IGNORED,
        errorMessage: reason,
        processedAt: new Date(),
      })
      .where(eq(bankWebhookEvents.id, eventId));
  }
}
