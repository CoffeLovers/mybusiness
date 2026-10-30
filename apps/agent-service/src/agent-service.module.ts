import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  RpcTenantContextInterceptor,
  RpcTenantGuard,
  getRootEnvFilePaths,
} from '@mybusiness/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentRepository } from './agent.repository';
import { AgentDatabaseService } from './database/database.service';
import { EmbeddingModule } from './embeddings';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    EmbeddingModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentDatabaseService,
    AgentRepository,
    AgentService,
    {
      provide: APP_GUARD,
      useClass: RpcTenantGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RpcTenantContextInterceptor,
    },
  ],
  exports: [AgentService, AgentRepository],
})
export class AgentServiceModule {}
