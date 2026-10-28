import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { setupGatewayApp } from './setup';

async function bootstrap() {
  const logger = new Logger('APIGateway');
  const app = await NestFactory.create(AppModule);

  // Aplicar configuración unificada de middlewares, seguridad, CORS y filtros
  setupGatewayApp(app);

  // Swagger OpenAPI Docs
  const config = new DocumentBuilder()
    .setTitle('MyBusiness API Gateway')
    .setDescription('Documentación de endpoints públicos y proxy a microservicios de MyBusiness')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 API Gateway escuchando en http://localhost:${port}/api/v1`);
  logger.log(`📚 Swagger Docs disponibles en http://localhost:${port}/docs`);
}
bootstrap();
