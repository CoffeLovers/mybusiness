import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_SERVICE, type IEmbeddingService } from './embedding.interface';
import { MockEmbeddingService } from './mock-embedding.service';
import { OpenAiEmbeddingService } from './openai-embedding.service';

@Module({
  providers: [
    MockEmbeddingService,
    {
      provide: EMBEDDING_SERVICE,
      useFactory: (config: ConfigService, mockService: MockEmbeddingService): IEmbeddingService => {
        const provider = config.get<string>('EMBEDDING_PROVIDER', 'mock');
        const nodeEnv = config.get<string>('NODE_ENV', 'development');

        if (provider === 'mock') {
          if (nodeEnv === 'production') {
            throw new Error(
              'EMBEDDING_PROVIDER=mock no está permitido en producción. Configure un proveedor real.',
            );
          }
          return mockService;
        }

        if (provider === 'openai') {
          return new OpenAiEmbeddingService(config);
        }

        throw new Error(`EMBEDDING_PROVIDER no soportado: ${provider}`);
      },
      inject: [ConfigService, MockEmbeddingService],
    },
  ],
  exports: [EMBEDDING_SERVICE, MockEmbeddingService],
})
export class EmbeddingModule {}
