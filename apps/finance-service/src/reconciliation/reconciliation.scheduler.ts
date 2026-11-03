import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, queueToken } from '@mybusiness/common';
import { FinanceDatabaseService } from '../database/database.service';
import { reconciliationSettings } from '../database/schema';
import { eq } from 'drizzle-orm';

/**
 * Planificador del cron nocturno de conciliación bancaria.
 * Configura un job scheduler BullMQ por tenant según su zona horaria a las 02:00 AM.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    @Inject(queueToken(QUEUE_NAMES.RECONCILIATION)) private readonly queue: Queue,
    private readonly database: FinanceDatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.initNightlySchedulers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudieron inicializar los cron schedulers nocturnos: ${message}`);
    }
  }

  /**
   * Carga todos los tenants con `nightlyEnabled = true` y programa su scheduler.
   */
  async initNightlySchedulers(): Promise<void> {
    const tenantsWithNightly = await this.database.db
      .select({
        tenantId: reconciliationSettings.tenantId,
        timezone: reconciliationSettings.timezone,
      })
      .from(reconciliationSettings)
      .where(eq(reconciliationSettings.nightlyEnabled, true));

    for (const item of tenantsWithNightly) {
      await this.scheduleNightly(item.tenantId, item.timezone);
    }

    this.logger.log(
      `Cron nocturno de conciliación configurado para ${tenantsWithNightly.length} tenant(s).`,
    );
  }

  /**
   * Registra o actualiza el scheduler nocturno de BullMQ a las 02:00 AM en la zona horaria indicada.
   */
  async scheduleNightly(tenantId: string, timezone = 'America/Bogota'): Promise<void> {
    const schedulerKey = `reconciliation:${tenantId}`;
    try {
      await this.queue.upsertJobScheduler(
        schedulerKey,
        { pattern: '0 2 * * *', tz: timezone },
        {
          name: 'nightly',
          data: { tenantId, trigger: 'NIGHTLY' },
        },
      );
      this.logger.log(`JobScheduler nocturno programado: ${schedulerKey} (tz: ${timezone})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al programar JobScheduler ${schedulerKey}: ${message}`);
      throw error;
    }
  }

  /**
   * Elimina el scheduler nocturno del tenant en BullMQ.
   */
  async removeNightly(tenantId: string): Promise<void> {
    const schedulerKey = `reconciliation:${tenantId}`;
    try {
      await this.queue.removeJobScheduler(schedulerKey);
      this.logger.log(`JobScheduler nocturno eliminado: ${schedulerKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al eliminar JobScheduler ${schedulerKey}: ${message}`);
    }
  }
}
