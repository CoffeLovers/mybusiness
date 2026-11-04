import { Module } from '@nestjs/common';
import { AgentDatabaseService } from '../database/database.service';
import { EmbeddingModule } from '../embeddings';
import { SemanticCacheRepository } from './semantic-cache.repository';
import { SEMANTIC_CACHE_REPOSITORY } from './semantic-cache.repository.interface';
import { SemanticCacheService } from './semantic-cache.service';

@Module({
  imports: [EmbeddingModule],
  providers: [
    AgentDatabaseService,
    {
      provide: SEMANTIC_CACHE_REPOSITORY,
      useClass: SemanticCacheRepository,
    },
    SemanticCacheRepository,
    SemanticCacheService,
  ],
  exports: [SemanticCacheService, SEMANTIC_CACHE_REPOSITORY],
})
export class SemanticCacheModule {}
