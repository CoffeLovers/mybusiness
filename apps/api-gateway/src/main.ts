import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import {
  GlobalExceptionFilter,
  LoggingInterceptor,
  TransformInterceptor,
} from '@mybusiness/common';

async function bootstrap() {
  const logger = new Logger('APIGateway');
  const app = await NestFactory.create(AppModule);

  // Security Headers
  app.use(helmet());
  app.use(cookieParser());

  // CORS
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Global Pipes & Interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

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
