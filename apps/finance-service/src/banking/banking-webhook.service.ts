import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { BankProvider } from '@mybusiness/contracts';
import { FinanceDatabaseService } from '../database/database.service';
import { bankConnections, bankWebhookEvents } from '../database/schema';
import { BankingAggregatorService } from './banking-aggregator.service';
import { BankingService } from './banking.service';

@Injectable()
export class BankingWebhookService {
  private readonly logger = new Logger(BankingWebhookService.name);

  constructor(
    private readonly databaseService: FinanceDatabaseService,
    private readonly aggregatorService: BankingAggregatorService,
    @Inject(forwardRef(() => BankingService))
    private readonly bankingService: BankingService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  /**
   * Recibe, deduplica e indexa eventos webhook de proveedores bancarios.
   * Garantiza idempotencia mediante UNIQUE(provider, provider_event_key).
   */
  async handleIncomingWebhook(
    provider: BankProvider,
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<{ status: string; eventId?: string }> {
    const adapter = this.aggregatorService.getAdapter(provider);

    let parsedEvent = {
      providerEventKey: `${provider}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      webhookType: 'GENERIC',
      webhookCode: undefined as string | undefined,
      providerItemId: undefined as string | undefined,
    };

    if (adapter.handleWebhook) {
      try {
        const result = await adapter.handleWebhook(payload, headers);
        parsedEvent = {
          providerEventKey: result.providerEventKey,
          webhookType: result.webhookType,
          webhookCode: result.webhookCode,
          providerItemId: result.providerItemId,
        };
      } catch (err: unknown) {
        this.logger.warn(
          `No fue posible parsear el webhook con el adapter ${provider}: ${
            err instanceof Error ? err.message : 'Error desconocido'
          }`,
        );
      }
    }

    // 1. Deduplicación por (provider, provider_event_key)
    const [existing] = await this.db
      .select()
      .from(bankWebhookEvents)
      .where(
        and(
          eq(bankWebhookEvents.provider, provider),
          eq(bankWebhookEvents.providerEventKey, parsedEvent.providerEventKey),
        ),
      )
      .limit(1);

    if (existing) {
      this.logger.log(
        `Webhook duplicado ignorado: provider=${provider}, eventKey=${parsedEvent.providerEventKey}`,
      );
      return { status: 'already_processed', eventId: existing.id };
    }

    // 2. Asociar conexión si providerItemId está presente
    let connectionId: string | null = null;
    if (parsedEvent.providerItemId) {
      const [connection] = await this.db
        .select({ id: bankConnections.id })
        .from(bankConnections)
        .where(
          and(
            eq(bankConnections.provider, provider),
            eq(bankConnections.providerItemId, parsedEvent.providerItemId),
          ),
        )
        .limit(1);

      if (connection) {
        connectionId = connection.id;
      }
    }

    // 3. Registrar en bank_webhook_events
    const [eventRecord] = await this.db
      .insert(bankWebhookEvents)
      .values({
        provider,
        providerEventKey: parsedEvent.providerEventKey,
        webhookType: parsedEvent.webhookType,
        webhookCode: parsedEvent.webhookCode,
        connectionId: connectionId || undefined,
        payload,
        processingStatus: 'pending',
      })
      .returning();

    // 4. Procesamiento asíncrono / enrutamiento según tipo de evento
    try {
      if (connectionId && provider === BankProvider.PLAID) {
        if (
          parsedEvent.webhookType === 'TRANSACTIONS' &&
          (parsedEvent.webhookCode === 'SYNC_UPDATES_AVAILABLE' ||
            parsedEvent.webhookCode === 'DEFAULT_UPDATE' ||
            parsedEvent.webhookCode === 'HISTORICAL_UPDATE')
        ) {
          this.logger.log(
            `Disparando sincronización por webhook para connectionId: ${connectionId}`,
          );
          // Ejecución en segundo plano sin bloquear respuesta HTTP del webhook
          this.bankingService
            .internalSyncConnection(connectionId)
            .catch((err) =>
              this.logger.error(
                `Error en sync disparado por webhook: ${err instanceof Error ? err.message : 'Error'}`,
              ),
            );
        }
      }

      await this.db
        .update(bankWebhookEvents)
        .set({
          processingStatus: 'processed',
          processedAt: new Date(),
        })
        .where(eq(bankWebhookEvents.id, eventRecord.id));

      return { status: 'processed', eventId: eventRecord.id };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Error al procesar webhook';
      await this.db
        .update(bankWebhookEvents)
        .set({
          processingStatus: 'failed',
          errorMessage,
          processedAt: new Date(),
        })
        .where(eq(bankWebhookEvents.id, eventRecord.id));

      return { status: 'failed', eventId: eventRecord.id };
    }
  }
}
