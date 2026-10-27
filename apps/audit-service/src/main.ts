import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { AuditServiceModule } from './audit-service.module';

async function bootstrap() {
  const logger = new Logger('AuditService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AuditServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });

  await app.listen();
  logger.log(
    `📜 Audit & Logging Service conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
