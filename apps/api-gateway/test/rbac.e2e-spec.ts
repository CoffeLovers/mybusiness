import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { of } from 'rxjs';
import { loadRootEnv } from '@mybusiness/common';
import { UserRole } from '@mybusiness/contracts';
import { AppModule } from '../src/app.module';
import { setupGatewayApp } from '../src/setup';
import { UNAUTHENTICATED_TENANT_ID } from '../src/security-audit.filter';

loadRootEnv();

// Variables explícitas de prueba para evitar fallos en entornos de CI limpios
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6380';
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'test-redis-password';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_key_at_least_32_characters_long';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:3000';
process.env.TRUST_PROXY_HOPS = '1';

interface CapturedCall {
  service: string;
  pattern: string;
  data: Record<string, any>;
}

interface CapturedEvent {
  service: string;
  pattern: string;
  data: Record<string, any>;
}

describe('RBAC Multi-Tenant E2E (API Gateway)', () => {
  let app: INestApplication;
  let server: any;
  let jwtService: JwtService;

  const rpcCalls: CapturedCall[] = [];
  const auditEvents: CapturedEvent[] = [];

  const mockClient = (service: string) => ({
    send: (pattern: any, data: any) => {
      rpcCalls.push({ service, pattern, data });
      return of({ success: true, service, pattern, data });
    },
    emit: (pattern: any, data: any) => {
      auditEvents.push({ service, pattern, data });
      return of(true);
    },
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('AUTH_SERVICE')
      .useValue(mockClient('AUTH_SERVICE'))
      .overrideProvider('FINANCE_SERVICE')
      .useValue(mockClient('FINANCE_SERVICE'))
      .overrideProvider('AGENT_SERVICE')
      .useValue(mockClient('AGENT_SERVICE'))
      .overrideProvider('AUDIT_SERVICE')
      .useValue(mockClient('AUDIT_SERVICE'))
      .compile();

    app = moduleFixture.createNestApplication();
    setupGatewayApp(app);
    await app.init();

    server = app.getHttpServer();
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function signToken(tokenTenant: string, role: UserRole, userId = 'user-1'): string {
    return jwtService.sign({
      sub: userId,
      email: `${userId}@example.com`,
      tenantId: tokenTenant,
      role,
    });
  }

  function validTransaction() {
    return {
      bankAccountId: 'acc-1',
      amountMinor: '250000',
      currency: 'COP',
      type: 'EXPENSE',
      description: 'Servicio Cloud AWS',
      idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  it('1) VIEWER no puede crear transacciones (403) y el intento queda auditado', async () => {
    const token = signToken('tenant-viewer', UserRole.VIEWER);
    const before = auditEvents.length;

    const res = await request(server)
      .post('/api/v1/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(validTransaction());

    expect(res.status).toBe(403);
    expect(rpcCalls.filter((call) => call.pattern === 'finance.transactions.create')).toHaveLength(
      0,
    );

    const securityAudit = auditEvents
      .slice(before)
      .find((event) => event.service === 'AUDIT_SERVICE' && event.pattern === 'audit.log_event');
    expect(securityAudit).toBeDefined();
    expect(securityAudit?.data.tenantId).toBe('tenant-viewer');
    expect(securityAudit?.data.userId).toBe('user-1');
    expect(securityAudit?.data.role).toBe(UserRole.VIEWER);
    expect(securityAudit?.data.action).toContain('SECURITY_403');
  });

  it('2) el tenant del token prevalece sobre x-tenant-id en el payload RPC', async () => {
    const token = signToken('tenant-A', UserRole.ACCOUNTANT);

    const res = await request(server)
      .post('/api/v1/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', 'tenant-B')
      .send(validTransaction());

    expect(res.status).toBe(201);

    const rpcCall = rpcCalls.find((call) => call.pattern === 'finance.transactions.create');
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.data.tenantId).toBe('tenant-A');
    expect(rpcCall?.data.tenantId).not.toBe('tenant-B');
    expect(rpcCall?.data.userId).toBe('user-1');
    expect(rpcCall?.data.role).toBe(UserRole.ACCOUNTANT);
  });

  it('3) rechaza con 400 el spoofing de tenantId/userId/role en el body', async () => {
    const token = signToken('tenant-A', UserRole.TENANT_ADMIN);
    const before = rpcCalls.length;

    const res = await request(server)
      .post('/api/v1/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validTransaction(),
        tenantId: 'tenant-B',
        userId: 'otro-usuario',
        role: UserRole.SUPER_ADMIN,
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('tenantId');
    expect(rpcCalls.length).toBe(before);
  });

  it('4) sin token, x-tenant-id no autentica: responde 401 y audita el rechazo', async () => {
    const before = auditEvents.length;
    const callsBefore = rpcCalls.filter(
      (call) => call.pattern === 'finance.transactions.create',
    ).length;

    const res = await request(server)
      .post('/api/v1/finance/transactions')
      .set('x-tenant-id', 'tenant-B')
      .send(validTransaction());

    expect(res.status).toBe(401);
    expect(rpcCalls.filter((call) => call.pattern === 'finance.transactions.create').length).toBe(
      callsBefore,
    );

    const securityAudit = auditEvents
      .slice(before)
      .find((event) => event.service === 'AUDIT_SERVICE' && event.pattern === 'audit.log_event');
    expect(securityAudit).toBeDefined();
    expect(securityAudit?.data.action).toContain('SECURITY_401');
    expect(securityAudit?.data.tenantId).toBe(UNAUTHENTICATED_TENANT_ID);
  });
});
