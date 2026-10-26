import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  const logger = new Logger('AuthService');
  const port = parseInt(process.env.AUTH_SERVICE_PORT || '3001', 10);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AuthServiceModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port,
    },
  });

  await app.listen();
  logger.log(`🛡️ Auth & Identity Service corriendo en TCP puerto ${port}`);
}
bootstrap();
