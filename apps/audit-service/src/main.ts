import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RpcTelemetryInterceptor, startTelemetry } from '@mybusiness/telemetry';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { AuditServiceModule } from './audit-service.module';

startTelemetry({ serviceName: 'audit-service' });

async function bootstrap() {
  const logger = new Logger('AuditService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AuditServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });
  // Span consumidor por mensaje del bus (padre = carrier W3C del gateway).
  app.useGlobalInterceptors(new RpcTelemetryInterceptor());
  app.enableShutdownHooks();

  await app.listen();
  logger.log(
    `📜 Audit & Logging Service conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
