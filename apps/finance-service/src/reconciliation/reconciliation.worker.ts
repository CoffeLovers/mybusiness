import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { BankConnectionStatus, type ReconciliationJobData } from '@mybusiness/contracts';
import {
  QUEUE_NAMES,
  createWorker,
  drainAndClose,
  registerWorker,
  resolveConcurrency,
} from '@mybusiness/common';
import { BankingService } from '../banking/banking.service';
import { FinanceDatabaseService } from '../database/database.service';
import { bankConnections } from '../database/schema';
import { ReconciliationService } from './reconciliation.service';

/**
 * Consumidor BullMQ de la cola `reconciliation`.
 * Sincroniza incrementalmente las conexiones bancarias del tenant y ejecuta el motor de conciliación.
 */
@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly bankingService: BankingService,
    private readonly database: FinanceDatabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const concurrency = resolveConcurrency(QUEUE_NAMES.RECONCILIATION);

    this.worker = createWorker(
      QUEUE_NAMES.RECONCILIATION,
      async (job) => this.processJob(job.data as ReconciliationJobData),
      { config: this.config, concurrency },
    );

    registerWorker(this.worker);
    this.logger.log(`Worker reconciliation iniciado con concurrencia ${concurrency}`);
  }

  /**
   * Ejecuta el flujo por tenant:
   * 1. Obtiene conexiones activas del tenant.
   * 2. Ejecuta BankingService.internalSyncConnection por conexión para recuperar movimientos y actualizar lastSyncedAt.
   * 3. Continúa ante fallos parciales acumulando errores.
   * 4. Ejecuta runForTenant para conciliar.
   * 5. Al final, si hubo errores en alguna conexión, relanza para que BullMQ reintente con backoff exponencial.
   */
  async processJob(data: ReconciliationJobData): Promise<void> {
    const { tenantId, trigger, from, to } = data;
    this.logger.log(`Iniciando job de conciliación para tenant ${tenantId} (trigger: ${trigger})`);

    // 1. Obtener conexiones activas del tenant
    const activeConnections = await this.database.db
      .select({ id: bankConnections.id, institutionName: bankConnections.institutionName })
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.tenantId, tenantId),
          eq(bankConnections.status, BankConnectionStatus.ACTIVE),
          isNull(bankConnections.deletedAt),
        ),
      );

    // 2. Sincronizar conexiones bancarias acumulando errores parciales
    const syncErrors: string[] = [];

    for (const connection of activeConnections) {
      try {
        await this.bankingService.internalSyncConnection(connection.id);
        this.logger.log(
          `Conexión ${connection.id} (${connection.institutionName}) sincronizada con éxito`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Error al sincronizar conexión ${connection.id}: ${message}`);
        syncErrors.push(`Conexión ${connection.id}: ${message}`);
      }
    }

    // 3. Ejecutar motor de conciliación para el tenant
    await this.reconciliationService.runForTenant(tenantId, trigger, from, to);

    // 4. Si alguna conexión falló, relanzar para que BullMQ reintente con backoff exponencial
    if (syncErrors.length > 0) {
      const consolidatedError = `Fallo parcial al sincronizar ${syncErrors.length} conexión(es): ${syncErrors.join('; ')}`;
      this.logger.error(consolidatedError);
      throw new Error(consolidatedError);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      await drainAndClose([this.worker], []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo cerrar el worker reconciliation: ${message}`);
    }
  }
}
