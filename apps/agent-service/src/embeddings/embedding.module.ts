import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_SERVICE } from './embedding.interface';
import { MockEmbeddingService } from './mock-embedding.service';

@Module({
  providers: [
    MockEmbeddingService,
    {
      provide: EMBEDDING_SERVICE,
      useFactory: (config: ConfigService, mockService: MockEmbeddingService) => {
        // Enchufable: Si se configura un proveedor real en el futuro (ej. OpenAI),
        // se puede instanciar aquí; de lo contrario se usa el Mock determinista.
        const provider = config.get<string>('EMBEDDING_PROVIDER', 'mock');
        if (provider === 'mock') {
          return mockService;
        }
        return mockService;
      },
      inject: [ConfigService, MockEmbeddingService],
    },
  ],
  exports: [EMBEDDING_SERVICE, MockEmbeddingService],
})
export class EmbeddingModule {}
