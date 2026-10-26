import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { FinanceServiceModule } from './finance-service.module';

async function bootstrap() {
  const logger = new Logger('FinanceService');
  const port = parseInt(process.env.FINANCE_SERVICE_PORT || '3002', 10);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(FinanceServiceModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port,
    },
  });

  await app.listen();
  logger.log(`💰 Finance & Banking Service corriendo en TCP puerto ${port}`);
}
bootstrap();
