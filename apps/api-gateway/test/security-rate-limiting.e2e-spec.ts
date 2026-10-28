import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { of } from 'rxjs';
import { loadRootEnv } from '@mybusiness/common';
import { AppModule } from '../src/app.module';
import { setupGatewayApp } from '../src/setup';

loadRootEnv();

// Variables explícitas de prueba para evitar fallos en entornos de CI limpios
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6380';
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'test-redis-password';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_key_at_least_32_characters_long';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS
  ? `${process.env.CORS_ORIGINS},https://app.mybusiness.com`
  : 'http://localhost:3000,https://app.mybusiness.com';
process.env.TRUST_PROXY_HOPS = '1';

describe('Security & Rate-Limiting E2E (API Gateway)', () => {
  let app: INestApplication;
  let server: any;

  // Mock de respuestas de microservicios para aislar pruebas del perímetro HTTP
  const mockClientProxy = {
    send: (pattern: any, data: any) => {
      const cmd = typeof pattern === 'string' ? pattern : pattern?.cmd;
      if (cmd === 'auth.login' || cmd === 'auth.register') {
        return of({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          user: {
            id: 'usr-123',
            email: data.email,
            role: 'admin',
            tenantId: 'ten-123',
          },
        });
      }
      return of({ success: true, data: [] });
    },
    emit: () => of(true),
  };

  beforeAll(async () => {
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

    // Bootstrap unificado idéntico a producción (main.ts): Helmet, CORS, ValidationPipe, Filters
    setupGatewayApp(app);

    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Cabeceras de Seguridad Helmet (OWASP & CSP)', () => {
    it('debe incluir X-Frame-Options: DENY, X-Content-Type-Options: nosniff, HSTS y Content-Security-Policy', async () => {
      const res = await request(server).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });
  });

  describe('2. CORS Dinámico y Manejo de Orígenes Rechazados', () => {
    it('debe permitir orígenes explícitamente listados en CORS_ORIGINS con credenciales', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('Origin', 'https://app.mybusiness.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://app.mybusiness.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('no debe emitir access-control-allow-origin ni responder con error 500 para orígenes no autorizados', async () => {
      const res = await request(server)
        .get('/api/v1/health')
        .set('Origin', 'http://sitio-malicioso.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('3. ValidationPipe Hermético (Sanitización y Whitelist de Payloads)', () => {
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

  describe('4. Rate-Limiting en /auth/login (5 req/min) y Protección Anti-Bypass de Headers', () => {
    const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

    it('debe permitir 5 peticiones y bloquear la 6ta aun cuando rote x-tenant-id o headers cliente', async () => {
      const loginPayload = { email: 'login-test@empresa.com', password: 'Password123!' };

      // Primeras 5 peticiones exitosas para la misma IP
      for (let i = 1; i <= 5; i++) {
        const res = await request(server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', clientIp)
          .send(loginPayload);

        expect(res.status).not.toBe(429);
      }

      // La 6ta petición debe ser bloqueada con 429
      const blockedRes = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send(loginPayload);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
      expect(blockedRes.headers['x-ratelimit-limit']).toBe('5');

      // Intento de evasión: rotando x-tenant-id y headers spoofed desde la misma IP
      const bypassAttempt = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', clientIp)
        .set('x-tenant-id', 'malicious-spoofed-tenant-id-rotation')
        .send(loginPayload);

      expect(bypassAttempt.status).toBe(429);
      expect(bypassAttempt.headers['x-ratelimit-remaining']).toBe('0');
    });
  });

  describe('5. Rate-Limiting en /auth/register (Política "auth": 5 req/min)', () => {
    const registerIp = `198.51.101.${Math.floor(Math.random() * 200) + 10}`;

    it('debe limitar intentos de registro público a 5 req/min por IP estricta', async () => {
      const registerPayload = {
        email: 'nuevo-registro@empresa.com',
        password: 'Password123!',
        firstName: 'Carlos',
        lastName: 'Gómez',
        companyName: 'Gómez Logistics SAS',
        taxId: '900999888-2',
      };

      for (let i = 1; i <= 5; i++) {
        const res = await request(server)
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', registerIp)
          .send(registerPayload);

        expect(res.status).not.toBe(429);
      }

      const blockedRegister = await request(server)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', registerIp)
        .send(registerPayload);

      expect(blockedRegister.status).toBe(429);
      expect(blockedRegister.headers['x-ratelimit-limit']).toBe('5');
    });
  });

  describe('6. Exención Completa de Rate-Limiting en Health Check (@SkipThrottle)', () => {
    it('debe permitir 105 peticiones continuas sin bloquearse ni emitir cabeceras de rate-limit', async () => {
      for (let i = 1; i <= 105; i++) {
        const res = await request(server).get('/api/v1/health');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      }
    });
  });

  describe('7. Rate-Limiting en Endpoints Generales (Política "api": 100 req/min)', () => {
    it('debe permitir 100 consultas y bloquear la 101va con límite 100', async () => {
      const jwtService = app.get(JwtService);
      const apiTenant = `tenant-api-${Date.now()}`;
      const token = jwtService.sign({
        sub: 'user-api-tester',
        email: 'api@test.com',
        tenantId: apiTenant,
        role: 'admin',
      });

      // Primeras 100 peticiones deben ser exitosas
      for (let i = 1; i <= 100; i++) {
        const res = await request(server)
          .get('/api/v1/finance/accounts')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).not.toBe(429);
      }

      // La 101va petición debe ser bloqueada con 429
      const blockedRes = await request(server)
        .get('/api/v1/finance/accounts')
        .set('Authorization', `Bearer ${token}`);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['x-ratelimit-limit']).toBe('100');
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('8. Rate-Limiting en Agentes de IA (Política "heavy": 10 req/min)', () => {
    it('debe aplicar límite de 10 req/min por tenant y bloquear en la 11va petición', async () => {
      const jwtService = app.get(JwtService);
      const uniqueTenant = `tenant-heavy-${Date.now()}`;
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
