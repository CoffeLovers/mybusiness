import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  RpcTenantContextInterceptor,
  RpcTenantGuard,
  getRootEnvFilePaths,
} from '@mybusiness/common';
import { AgentController } from './agent.controller';
import { AgentMemoryModule } from './agent-memory.module';
import { ChatModule } from './chat/chat.module';
import { McpModule } from './mcp/mcp.module';
import { BudgetModule } from './budget/budget.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    AgentMemoryModule,
    McpModule,
    BudgetModule,
    ChatModule,
  ],
  controllers: [AgentController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RpcTenantGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RpcTenantContextInterceptor,
    },
  ],
  exports: [AgentMemoryModule, BudgetModule, ChatModule],
})
export class AgentServiceModule {}
