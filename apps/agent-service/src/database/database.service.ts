import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, type AgentDatabase } from './client';

/**
 * Mantiene la conexión a `agent_db` y la cierra al destruir el módulo.
 */
@Injectable()
export class AgentDatabaseService implements OnModuleDestroy {
  private readonly connection: ReturnType<typeof createDatabase>;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('AGENT_DATABASE_URL'));
  }

  get db(): AgentDatabase {
    return this.connection.db;
  }

  get pool() {
    return this.connection.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end();
  }
}
