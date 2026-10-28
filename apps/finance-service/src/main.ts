import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { FinanceServiceModule } from './finance-service.module';

async function bootstrap() {
  const logger = new Logger('FinanceService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(FinanceServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });

  await app.listen();
  logger.log(
    `💰 Finance & Banking Service conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
