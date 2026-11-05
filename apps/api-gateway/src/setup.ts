import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { LoggingInterceptor, TransformInterceptor } from '@mybusiness/common';

/**
 * Configura los middlewares, cabeceras de seguridad OWASP, CORS dinámico,
 * pipes de validación y filtros globales compartidos entre el bootstrap de main.ts y la suite e2e.
 */
export function setupGatewayApp(app: INestApplication): void {
  // Trust Proxy para resolución segura de req.ip en Express tras balanceadores
  const httpAdapter = app.getHttpAdapter().getInstance();
  if (httpAdapter && typeof httpAdapter.set === 'function') {
    httpAdapter.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
  }

  // Security Headers (OWASP: HSTS, CSP, X-Frame-Options: DENY, nosniff)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          objectSrc: ["'none'"],
        },
      },
      frameguard: {
        action: 'deny',
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
    }),
  );
  app.use(cookieParser());

  // CORS Restrictivo Dinámico contra CORS_ORIGINS
  const corsOriginsEnv = process.env.CORS_ORIGINS || 'http://localhost:3000';
  const allowedOrigins = corsOriginsEnv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.includes('*')) {
    throw new Error(
      'Configuración insegura: CORS_ORIGINS no puede ser "*" cuando credentials está activado.',
    );
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Permitir peticiones sin origen (por ejemplo mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Rechazo limpio sin generar excepciones 500 no controladas
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-refresh-token',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Global Pipes & Interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());
  // Los filtros globales (incluido SecurityAuditFilter) se registran vía APP_FILTER
  // en AppModule para garantizar el orden de resolución y la inyección de dependencias.
}
