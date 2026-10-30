import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase } from './client';

/**
 * Mantiene la conexión a audit_db por proceso y cierra el pool de conexiones al destruir el módulo.
 * Inyectable para facilitar mock en tests unitarios y aislamiento en NestJS.
 */
@Injectable()
export class AuditDatabaseService implements OnModuleDestroy {
  private readonly connection: ReturnType<typeof createDatabase>;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('AUDIT_DATABASE_URL'));
  }

  get db() {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end();
  }
}
