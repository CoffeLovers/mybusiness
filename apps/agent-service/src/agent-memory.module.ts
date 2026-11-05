import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentRepository } from './agent.repository';
import { AgentDatabaseService } from './database/database.service';
import { EmbeddingModule } from './embeddings';

/**
 * Módulo de memoria semántica.
 *
 * Se separa de `AgentServiceModule` para que `ChatModule` pueda consumir
 * `AgentService` sin crear un ciclo de módulos con `ChatModule`.
 */
@Module({
  imports: [EmbeddingModule],
  providers: [AgentDatabaseService, AgentRepository, AgentService],
  exports: [AgentService, AgentRepository],
})
export class AgentMemoryModule {}
