import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  AuditEvents,
  BankProvider,
  BankWebhookProcessingStatus,
  type BankWebhookJobData,
  type ReplayBankWebhookResponse,
  type RequestContext,
} from '@mybusiness/contracts';
import { QUEUE_NAMES, buildJobId, queueToken } from '@mybusiness/common';
import { FinanceDatabaseService } from '../database/database.service';
import { bankConnections, bankWebhookEvents } from '../database/schema';
import { DomainEventPublisher } from '../events/domain-event.publisher';
import { BankingAggregatorService } from './banking-aggregator.service';
import type { WebhookResult } from './adapters/base-adapter.interface';

/** Códigos de Plaid que requieren disparar una sincronización de transacciones. */
const PLAID_SYNC_CODES = new Set(['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'HISTORICAL_UPDATE']);

export interface IncomingWebhookResult {
  status: BankWebhookProcessingStatus | 'already_processed';
  eventId?: string;
}

@Injectable()
export class BankingWebhookService {
  private readonly logger = new Logger(BankingWebhookService.name);

  constructor(
    private readonly databaseService: FinanceDatabaseService,
    private readonly aggregatorService: BankingAggregatorService,
    @Inject(queueToken(QUEUE_NAMES.BANKING_SYNC))
    private readonly queue: Queue,
    private readonly events: DomainEventPublisher,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  /**
   * Recibe, valida, deduplica y encola eventos webhook de proveedores bancarios.
   * Fail-closed: si la autenticación o verificación falla, propaga 4xx sin insertar nada en DB.
   * Garantiza idempotencia mediante UNIQUE(provider, provider_event_key).
   *
   * El procesamiento (sync) ocurre en un worker BullMQ; este método sólo persiste
   * el estado `received` y responde rápido al proveedor.
   */
  async handleIncomingWebhook(
    provider: BankProvider,
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
    rawBody?: string,
  ): Promise<IncomingWebhookResult> {
    const adapter = this.aggregatorService.getAdapter(provider);
    if (typeof adapter.handleWebhook !== 'function') {
      throw new BadRequestException(`El proveedor ${provider} no soporta webhooks.`);
    }

    // Cualquier excepción (401/400) del adapter se propaga sin persistir nada en DB
    const parsedEvent = await adapter.handleWebhook(payload, headers, rawBody);

    if (!parsedEvent.providerEventKey || parsedEvent.providerEventKey.length > 255) {
      throw new BadRequestException('providerEventKey inválida.');
    }
    if (!parsedEvent.webhookType) {
      throw new BadRequestException('webhookType es requerido.');
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
      await this.retryPendingEnqueue(existing);
      this.logger.log(
        `Webhook duplicado ignorado: provider=${provider}, eventKey=${parsedEvent.providerEventKey}`,
      );
      return { status: 'already_processed', eventId: existing.id };
    }

    // 2. Asociar conexión si providerItemId está presente
    const connectionId = await this.resolveConnectionId(provider, parsedEvent.providerItemId);

    // 3. Registrar en bank_webhook_events con onConflictDoNothing para cubrir condiciones de carrera
    const [eventRecord] = await this.db
      .insert(bankWebhookEvents)
      .values({
        provider,
        providerEventKey: parsedEvent.providerEventKey,
        webhookType: parsedEvent.webhookType,
        webhookCode: parsedEvent.webhookCode,
        connectionId: connectionId || undefined,
        payload,
        processingStatus: BankWebhookProcessingStatus.RECEIVED,
        occurredAt: parsedEvent.occurredAt ?? new Date(),
      })
      .onConflictDoNothing({
        target: [bankWebhookEvents.provider, bankWebhookEvents.providerEventKey],
      })
      .returning();

    if (!eventRecord) {
      // Carrera: otro proceso insertó el mismo evento entre el SELECT y el INSERT.
      return { status: 'already_processed' };
    }

    // 4. Eventos no accionables se cierran como `ignored` sin encolar trabajo.
    if (!connectionId || !this.isActionable(provider, parsedEvent)) {
      await this.markIgnored(
        eventRecord.id,
        connectionId ? 'evento_no_accionable' : 'conexion_no_encontrada',
      );
      return { status: BankWebhookProcessingStatus.IGNORED, eventId: eventRecord.id };
    }

    // 5. Encolar el procesamiento durable. Si Redis no responde, el evento queda
    //    en `failed` para permitir replay manual y se responde 503 al proveedor.
    try {
      await this.enqueue(eventRecord.id, connectionId, provider);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al encolar webhook';
      await this.markFailed(eventRecord.id, message);
      throw new ServiceUnavailableException(
        `No se pudo encolar el webhook ${eventRecord.id}: ${message}`,
      );
    }

    return { status: BankWebhookProcessingStatus.RECEIVED, eventId: eventRecord.id };
  }

  /**
   * Replay manual y auditado de un evento `failed` o `ignored`.
   * Sólo el tenant dueño de la conexión puede reencolarlo.
   */
  async replayWebhook(
    ctx: RequestContext,
    webhookId: string,
    force = false,
  ): Promise<ReplayBankWebhookResponse> {
    const [event] = await this.db
      .select()
      .from(bankWebhookEvents)
      .where(eq(bankWebhookEvents.id, webhookId))
      .limit(1);

    if (!event) {
      throw new NotFoundException('Evento de webhook no encontrado.');
    }

    if (!event.connectionId) {
      throw new NotFoundException('El evento no está asociado a una conexión.');
    }

    // El tenant se resuelve vía conexión: bank_webhook_events no guarda tenantId.
    const [connection] = await this.db
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.id, event.connectionId),
          eq(bankConnections.tenantId, ctx.tenantId),
          isNull(bankConnections.deletedAt),
        ),
      )
      .limit(1);

    if (!connection) {
      throw new NotFoundException('Evento de webhook no encontrado.');
    }

    if (
      event.processingStatus !== BankWebhookProcessingStatus.FAILED &&
      event.processingStatus !== BankWebhookProcessingStatus.IGNORED
    ) {
      throw new ConflictException(
        `Sólo se puede reprocesar un evento failed o ignored (estado actual: ${event.processingStatus}).`,
      );
    }

    if (event.processingStatus === BankWebhookProcessingStatus.IGNORED && !force) {
      throw new ConflictException(
        'El evento fue ignorado (p. ej. por orden); use force=true para reprocesarlo.',
      );
    }

    if (
      event.processingStatus === BankWebhookProcessingStatus.IGNORED &&
      event.errorMessage !== 'evento_fuera_de_orden'
    ) {
      throw new ConflictException(
        `El evento ignorado no es reprocesable (motivo: ${event.errorMessage ?? 'desconocido'}).`,
      );
    }

    const previousStatus = event.processingStatus;
    const replayCount = event.replayCount + 1;

    await this.db
      .update(bankWebhookEvents)
      .set({
        processingStatus: BankWebhookProcessingStatus.RECEIVED,
        errorMessage: null,
        processedAt: null,
        replayCount,
      })
      .where(eq(bankWebhookEvents.id, event.id));

    try {
      await this.enqueue(event.id, connection.id, event.provider as BankProvider, {
        force,
        replayCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al reencolar webhook';
      await this.markFailed(event.id, message);
      throw new ServiceUnavailableException(
        `No se pudo reencolar el webhook ${event.id}: ${message}`,
      );
    }

    await this.events.publish(AuditEvents.LOG_EVENT, {
      eventId: randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: ctx.role,
      action: 'banking.webhook.replay',
      entityName: 'bank_webhook_events',
      entityId: event.id,
      oldValues: { processingStatus: previousStatus, replayCount: event.replayCount },
      newValues: { processingStatus: BankWebhookProcessingStatus.RECEIVED, replayCount, force },
      timestamp: new Date().toISOString(),
    });

    return {
      eventId: event.id,
      status: BankWebhookProcessingStatus.RECEIVED,
      enqueued: true,
      replayCount,
    };
  }

  private async resolveConnectionId(
    provider: BankProvider,
    providerItemId?: string,
  ): Promise<string | null> {
    if (!providerItemId) {
      return null;
    }

    const [connection] = await this.db
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.provider, provider),
          eq(bankConnections.providerItemId, providerItemId),
          isNull(bankConnections.deletedAt),
        ),
      )
      .limit(1);

    return connection?.id ?? null;
  }

  private isActionable(provider: BankProvider, event: WebhookResult): boolean {
    return (
      provider === BankProvider.PLAID &&
      event.webhookType === 'TRANSACTIONS' &&
      event.webhookCode !== undefined &&
      PLAID_SYNC_CODES.has(event.webhookCode)
    );
  }

  /**
   * Si un duplicado quedó en `received` porque el encolado falló, reintenta
   * publicarlo con el mismo `jobId` determinista (BullMQ deduplica).
   */
  private async retryPendingEnqueue(event: {
    id: string;
    connectionId: string | null;
    provider: string;
    processingStatus: string;
  }): Promise<void> {
    if (event.processingStatus !== BankWebhookProcessingStatus.RECEIVED || !event.connectionId) {
      return;
    }

    try {
      await this.enqueue(event.id, event.connectionId, event.provider as BankProvider);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al reencolar webhook';
      this.logger.warn(`No se pudo reintentar el encolado del webhook ${event.id}: ${message}`);
    }
  }

  private async enqueue(
    eventId: string,
    connectionId: string,
    provider: BankProvider,
    options?: { force?: boolean; replayCount?: number },
  ): Promise<void> {
    const data: BankWebhookJobData = {
      eventId,
      connectionId,
      provider,
      force: options?.force ?? false,
    };

    const key =
      options?.replayCount !== undefined
        ? `webhook-replay:${eventId}:${options.replayCount}`
        : `webhook:${eventId}`;

    await this.queue.add(QUEUE_NAMES.BANKING_SYNC, data, {
      jobId: buildJobId(QUEUE_NAMES.BANKING_SYNC, key),
    });
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

  private async markFailed(eventId: string, message: string): Promise<void> {
    await this.db
      .update(bankWebhookEvents)
      .set({
        processingStatus: BankWebhookProcessingStatus.FAILED,
        errorMessage: message,
        processedAt: new Date(),
      })
      .where(eq(bankWebhookEvents.id, eventId));
  }
}
