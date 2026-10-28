import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase } from './client';

/**
 * Mantiene una única conexión por proceso y la cierra cuando Nest destruye el módulo.
 * La URL se obtiene de configuración; no hay fallback con credenciales.
 */
@Injectable()
export class AuthDatabaseService implements OnModuleDestroy {
  private readonly connection: ReturnType<typeof createDatabase>;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('AUTH_DATABASE_URL'));
  }

  get db() {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end();
  }
}
