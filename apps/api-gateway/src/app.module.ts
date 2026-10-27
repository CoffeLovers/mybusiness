import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ThrottlerModule } from '@nestjs/throttler';
import { getMicroserviceRedisOptions, getRootEnvFilePaths } from '@mybusiness/common';
import { HealthController } from './health/health.controller';
import { AuthGatewayController } from './auth/auth-gateway.controller';
import { FinanceGatewayController } from './finance/finance-gateway.controller';
import { AgentGatewayController } from './agent/agent-gateway.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    ClientsModule.registerAsync([
      {
        name: 'AUTH_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
      {
        name: 'FINANCE_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
      {
        name: 'AGENT_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
      {
        name: 'AUDIT_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.REDIS,
          options: getMicroserviceRedisOptions(config),
        }),
      },
    ]),
  ],
  controllers: [
    HealthController,
    AuthGatewayController,
    FinanceGatewayController,
    AgentGatewayController,
  ],
})
export class AppModule {}
