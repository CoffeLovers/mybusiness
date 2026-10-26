import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuditServiceModule } from './audit-service.module';

async function bootstrap() {
  const logger = new Logger('AuditService');
  const port = parseInt(process.env.AUDIT_SERVICE_PORT || '3004', 10);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AuditServiceModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port,
    },
  });

  await app.listen();
  logger.log(`📜 Audit & Logging Service corriendo en TCP puerto ${port}`);
}
bootstrap();
