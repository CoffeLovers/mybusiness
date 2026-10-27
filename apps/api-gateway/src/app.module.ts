import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller';
import { AuthGatewayController } from './auth/auth-gateway.controller';
import { FinanceGatewayController } from './finance/finance-gateway.controller';
import { AgentGatewayController } from './agent/agent-gateway.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
          transport: Transport.TCP,
          options: {
            host: config.get<string>('AUTH_SERVICE_HOST', 'localhost'),
            port: config.get<number>('AUTH_SERVICE_PORT', 3001),
          },
        }),
      },
      {
        name: 'FINANCE_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('FINANCE_SERVICE_HOST', 'localhost'),
            port: config.get<number>('FINANCE_SERVICE_PORT', 3002),
          },
        }),
      },
      {
        name: 'AGENT_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('AGENT_SERVICE_HOST', 'localhost'),
            port: config.get<number>('AGENT_SERVICE_PORT', 3003),
          },
        }),
      },
      {
        name: 'AUDIT_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('AUDIT_SERVICE_HOST', 'localhost'),
            port: config.get<number>('AUDIT_SERVICE_PORT', 3004),
          },
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
