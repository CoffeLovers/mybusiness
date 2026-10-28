import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { of } from 'rxjs';
import { AppModule } from '../src/app.module';

describe('Security & Rate-Limiting E2E (API Gateway)', () => {
  let app: INestApplication;
  let server: any;

  // Mock de respuestas de microservicios para aislar pruebas del perímetro
  const mockClientProxy = {
    send: (pattern: any, data: any) => {
      if (pattern.cmd === 'auth.login' || pattern === 'auth.login') {
        return of({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          user: { id: 'usr-123', email: data.email, role: 'admin', tenantId: 'ten-123' },
        });
      }
      return of({ success: true, data });
    },
    emit: () => of(true),
  };

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3000,https://app.mybusiness.com';
    process.env.JWT_SECRET = 'test_jwt_secret_key_at_least_32_characters_long';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('AUTH_SERVICE')
      .useValue(mockClientProxy)
      .overrideProvider('FINANCE_SERVICE')
      .useValue(mockClientProxy)
      .overrideProvider('AGENT_SERVICE')
      .useValue(mockClientProxy)
      .overrideProvider('AUDIT_SERVICE')
      .useValue(mockClientProxy)
      .compile();

    app = moduleFixture.createNestApplication();

    // 1. Helmet perimetral
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
        frameguard: { action: 'deny' },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        noSniff: true,
      }),
    );
    app.use(cookieParser());

    // 2. CORS restrictivo dinámico
    const allowedOrigins = (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origen CORS no permitido: ${origin}`), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'x-tenant-id',
        'x-refresh-token',
      ],
      exposedHeaders: [
        'Retry-After',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
      ],
    });

    // 3. Prefijo global
    app.setGlobalPrefix('api/v1');

    // 4. ValidationPipe con sanitización estricta
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Cabeceras de Seguridad Helmet (OWASP)', () => {
    it('debe incluir X-Frame-Options: DENY, X-Content-Type-Options: nosniff y HSTS', async () => {
      const res = await request(server).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  describe('2. CORS Dinámico', () => {
    it('debe permitir orígenes listados en CORS_ORIGINS', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('Origin', 'https://app.mybusiness.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://app.mybusiness.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('no debe emitir access-control-allow-origin para orígenes no autorizados', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('Origin', 'http://sitio-malicioso.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('3. ValidationPipe Hermético (Sanitización de Payloads)', () => {
    it('debe rechazar con 400 Bad Request si el payload contiene propiedades no tipadas en el DTO', async () => {
      const res = await request(server).post('/api/v1/auth/login').send({
        email: 'usuario@empresa.com',
        password: 'Password123!',
        campoInesperado: 'intento-de-inyeccion',
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('property campoInesperado should not exist');
    });
  });

  describe('4. Rate-Limiting en /auth/login (Política "auth": 5 req/min)', () => {
    const uniqueClientIp = `192.168.10.${Math.floor(Math.random() * 200) + 10}`;

    it('debe permitir hasta 5 peticiones por minuto y bloquear la 6ta con 429 y Retry-After', async () => {
      const loginPayload = { email: 'login-test@empresa.com', password: 'Password123!' };

      // Primeras 5 peticiones deben pasar
      for (let i = 1; i <= 5; i++) {
        const res = await request(server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', uniqueClientIp)
          .send(loginPayload);

        expect(res.status).not.toBe(429);
      }

      // La 6ta petición debe ser bloqueada inmediatamente con 429
      const blockedRes = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', uniqueClientIp)
        .send(loginPayload);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
      expect(blockedRes.headers['x-ratelimit-limit']).toBe('5');
    });
  });

  describe('5. Exención de Rate-Limiting en Health Check (@SkipThrottle)', () => {
    it('debe permitir múltiples consultas continuas a /health sin ser bloqueadas', async () => {
      for (let i = 1; i <= 10; i++) {
        const res = await request(server).get('/api/v1/health');
        expect(res.status).toBe(200);
      }
    });
  });

  describe('6. Rate-Limiting en Agentes de IA (Política "heavy": 10 req/min)', () => {
    it('debe aplicar límite de 10 req/min por tenant y bloquear en la 11va petición', async () => {
      const jwtService = app.get(JwtService);
      const uniqueTenant = `tenant-test-${Date.now()}`;
      const token = jwtService.sign({
        sub: 'user-agent-tester',
        email: 'agent@test.com',
        tenantId: uniqueTenant,
        role: 'admin',
      });

      const payload = {
        query: 'Balance consolidado del mes',
        limit: 5,
      };

      // Primeras 10 peticiones
      for (let i = 1; i <= 10; i++) {
        const res = await request(server)
          .post('/api/v1/agent/memory/query')
          .set('Authorization', `Bearer ${token}`)
          .send(payload);

        expect(res.status).not.toBe(429);
      }

      // La 11va petición debe ser bloqueada con 429
      const blockedRes = await request(server)
        .post('/api/v1/agent/memory/query')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
      expect(blockedRes.headers['x-ratelimit-limit']).toBe('10');
    });
  });
});
