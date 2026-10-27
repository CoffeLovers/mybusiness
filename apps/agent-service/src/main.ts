import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { AgentServiceModule } from './agent-service.module';

async function bootstrap() {
  const logger = new Logger('AgentService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AgentServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });

  await app.listen();
  logger.log(
    `🧠 Agent Memory Service (pgvector) conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
