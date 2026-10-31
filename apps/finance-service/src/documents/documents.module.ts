import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  QUEUE_NAMES,
  createQueue,
  getMicroserviceRedisOptions,
  queueToken,
} from '@mybusiness/common';
import { FinanceDatabaseModule } from '../database/database.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsWorker } from './documents.worker';
import { OCR_PROVIDER } from './ocr/ocr-provider.interface';
import { createOcrProvider } from './ocr/ocr.factory';
import { DOCUMENT_STORAGE } from './storage/document-storage.interface';
import { createDocumentStorage } from './storage/storage.factory';

@Module({
  imports: [
    ConfigModule,
    FinanceDatabaseModule,
    ClientsModule.registerAsync([
      {
        name: 'AGENT_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
    ]),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsWorker,
    {
      provide: DOCUMENT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDocumentStorage(config),
    },
    {
      provide: OCR_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createOcrProvider(config),
    },
    {
      provide: queueToken(QUEUE_NAMES.OCR),
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createQueue(QUEUE_NAMES.OCR, config),
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
