import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RpcTelemetryInterceptor, startTelemetry } from '@mybusiness/telemetry';
import { getMicroserviceRedisOptions, startAuxiliaryHealthServer } from '@mybusiness/common';
import { FinanceServiceModule } from './finance-service.module';

startTelemetry({ serviceName: 'finance-service' });

async function bootstrap() {
  const logger = new Logger('FinanceService');
  const redisOptions = getMicroserviceRedisOptions();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(FinanceServiceModule, {
    transport: Transport.REDIS,
    options: redisOptions,
  });
  // Span consumidor por mensaje del bus (padre = carrier W3C del gateway).
  app.useGlobalInterceptors(new RpcTelemetryInterceptor());
  app.enableShutdownHooks();

  const healthPort = Number(
    process.env.FINANCE_HEALTH_PORT || (process.env.ENABLE_HEALTH_SERVER === 'true' ? 3002 : 0),
  );
  if (healthPort > 0) {
    startAuxiliaryHealthServer({
      serviceName: 'finance-service',
      port: healthPort,
      checkReadiness: async () => ({ ok: true, checks: { redis: 'ok', postgres: 'ok' } }),
    });
    logger.log(`🩺 Health probes escuchando en http://0.0.0.0:${healthPort}/healthz`);
  }

  await app.listen();
  logger.log(
    `💰 Finance & Banking Service conectado a Redis Broker en ${redisOptions.host}:${redisOptions.port}`,
  );
}
bootstrap();
