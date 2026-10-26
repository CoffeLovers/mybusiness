import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AgentServiceModule } from './agent-service.module';

async function bootstrap() {
  const logger = new Logger('AgentService');
  const port = parseInt(process.env.AGENT_SERVICE_PORT || '3003', 10);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AgentServiceModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port,
    },
  });

  await app.listen();
  logger.log(`🧠 Agent Memory Service (pgvector) corriendo en TCP puerto ${port}`);
}
bootstrap();
