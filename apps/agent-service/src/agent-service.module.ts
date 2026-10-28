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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
  ],
  controllers: [AgentController],
  providers: [
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
})
export class AgentServiceModule {}
