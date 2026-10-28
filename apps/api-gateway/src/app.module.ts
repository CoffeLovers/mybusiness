import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  getMicroserviceRedisOptions,
  getRedisConfig,
  getRootEnvFilePaths,
  RolesGuard,
  TenantGuard,
} from '@mybusiness/common';
import { HealthController } from './health/health.controller';
import { AuthGatewayController } from './auth/auth-gateway.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { FinanceGatewayController } from './finance/finance-gateway.controller';
import { AgentGatewayController } from './agent/agent-gateway.controller';
import { DistributedThrottlerGuard, ThrottlerStorageRedisService } from './throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRootEnvFilePaths(),
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const issuer = config.get<string>('JWT_ISSUER', 'mybusiness');
        const audience = config.get<string>('JWT_AUDIENCE', 'mybusiness-api');

        return {
          secret: config.getOrThrow<string>('JWT_SECRET'),
          signOptions: { issuer, audience },
          verifyOptions: { issuer, audience },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'auth',
            ttl: 60000,
            limit: 5,
          },
          {
            name: 'api',
            ttl: 60000,
            limit: 100,
          },
          {
            name: 'heavy',
            ttl: 60000,
            limit: 10,
          },
        ],
        storage: new ThrottlerStorageRedisService(getRedisConfig(config)),
      }),
    }),
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
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DistributedThrottlerGuard,
    },
  ],
})
export class AppModule {}
