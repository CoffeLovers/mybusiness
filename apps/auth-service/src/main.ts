import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { getMicroserviceRedisOptions } from '@mybusiness/common';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  const logger = new Logger('AuthService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AuthServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });

  await app.listen();
  logger.log(
    `🛡️ Auth & Identity Service conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
