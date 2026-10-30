import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase } from './client';

/**
 * Mantiene una única conexión a finance_db por proceso y la cierra al destruir el módulo.
 * La URL se obtiene de configuración; no hay fallback con credenciales.
 */
@Injectable()
export class FinanceDatabaseService implements OnModuleDestroy {
  private readonly connection: ReturnType<typeof createDatabase>;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('FINANCE_DATABASE_URL'));
  }

  get db() {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end();
  }
}
