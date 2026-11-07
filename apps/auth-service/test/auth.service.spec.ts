import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole, UserStatus, type RegisterDto } from '@mybusiness/contracts';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthRepository,
  RefreshTokenExpiredError,
  RefreshTokenReuseError,
  type CreateTenantUserInput,
  type UserWithTenant,
} from '../src/auth.repository';
import { AuthService } from '../src/auth.service';
import { generateRefreshToken, hashRefreshToken } from '../src/auth.tokens';
import type { NewRefreshToken, RefreshToken, Tenant, User } from '../src/database/schema';

const PASSWORD = 'password-seguro-123';
const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';

class FakeAuthRepository {
  readonly usersByEmail = new Map<string, UserWithTenant>();
  readonly usersById = new Map<string, UserWithTenant>();
  readonly tenantsByTaxId = new Map<string, Tenant>();
  readonly tokens = new Map<string, RefreshToken>();
  createFailure: unknown;
  reuseOnRotate = false;
  expireOnRotate = false;

  addUser(
    userOverrides: Partial<User> = {},
    tenantOverrides: Partial<Tenant> = {},
  ): UserWithTenant {
    const now = new Date();
    const tenant: Tenant = {
      id: randomUUID(),
      legalName: 'Demo S.A.S.',
      tradeName: 'Demo',
      taxId: `tax-${randomUUID()}`,
      country: 'CO',
      currency: 'COP',
      timezone: 'America/Bogota',
      status: TenantStatus.ACTIVE,
      settings: {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...tenantOverrides,
    };
    const user: User = {
      id: randomUUID(),
      tenantId: tenant.id,
      email: 'user@example.test',
      passwordHash: 'hash',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: UserRole.TENANT_ADMIN,
      status: UserStatus.ACTIVE,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...userOverrides,
    };
    const record = { user, tenant };
    this.usersByEmail.set(user.email, record);
    this.usersById.set(user.id, record);
    this.tenantsByTaxId.set(tenant.taxId, tenant);
    return record;
  }

  addRefreshToken(input: NewRefreshToken): RefreshToken {
    const token: RefreshToken = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      isRevoked: input.isRevoked ?? false,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt ?? null,
      replacedByTokenId: input.replacedByTokenId ?? null,
      createdAt: input.createdAt ?? new Date(),
    };
    this.tokens.set(token.id, token);
    return token;
  }

  async findUserByEmail(email: string): Promise<UserWithTenant | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async findUserById(userId: string): Promise<UserWithTenant | null> {
    return this.usersById.get(userId) ?? null;
  }

  async findTenantByTaxId(taxId: string): Promise<Tenant | null> {
    return this.tenantsByTaxId.get(taxId) ?? null;
  }

  async createTenantAndUser(input: CreateTenantUserInput): Promise<UserWithTenant> {
    if (this.createFailure) {
      throw this.createFailure;
    }

    const now = new Date();
    const tenant: Tenant = {
      id: randomUUID(),
      legalName: input.companyName,
      tradeName: input.companyName,
      taxId: input.taxId,
      country: input.country ?? 'CO',
      currency: input.currency ?? 'COP',
      timezone: 'America/Bogota',
      status: TenantStatus.ACTIVE,
      settings: {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const user: User = {
      id: randomUUID(),
      tenantId: tenant.id,
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: UserRole.TENANT_ADMIN,
      status: UserStatus.ACTIVE,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const record = { user, tenant };
    this.usersByEmail.set(user.email, record);
    this.usersById.set(user.id, record);
    this.tenantsByTaxId.set(tenant.taxId, tenant);
    return record;
  }

  async updateLastLogin(userId: string): Promise<void> {
    const record = this.usersById.get(userId);
    if (record) {
      record.user.lastLoginAt = new Date();
    }
  }

  async createRefreshToken(input: NewRefreshToken): Promise<RefreshToken> {
    return this.addRefreshToken(input);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return [...this.tokens.values()].find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async rotateRefreshToken(
    currentTokenId: string,
    nextToken: NewRefreshToken,
  ): Promise<RefreshToken> {
    if (this.reuseOnRotate) {
      throw new RefreshTokenReuseError();
    }

    if (this.expireOnRotate) {
      throw new RefreshTokenExpiredError();
    }

    const current = this.tokens.get(currentTokenId);
    if (!current) {
      throw new RefreshTokenExpiredError();
    }

    const next = this.addRefreshToken(nextToken);
    this.tokens.set(current.id, {
      ...current,
      isRevoked: true,
      revokedAt: new Date(),
      replacedByTokenId: next.id,
    });
    return next;
  }

  async revokeToken(tokenId: string): Promise<void> {
    const current = this.tokens.get(tokenId);
    if (current && !current.isRevoked) {
      this.tokens.set(tokenId, { ...current, isRevoked: true, revokedAt: new Date() });
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.familyId === familyId && !token.isRevoked) {
        this.tokens.set(id, { ...token, isRevoked: true, revokedAt: new Date() });
      }
    }
  }

  async revokeAllForUser(userId: string): Promise<number> {
    let revoked = 0;

    for (const [id, token] of this.tokens) {
      if (token.userId === userId && !token.isRevoked) {
        this.tokens.set(id, { ...token, isRevoked: true, revokedAt: new Date() });
        revoked += 1;
      }
    }

    return revoked;
  }

  familyTokens(familyId: string): RefreshToken[] {
    return [...this.tokens.values()].filter((token) => token.familyId === familyId);
  }
}

describe('AuthService', () => {
  let repository: FakeAuthRepository;
  let service: AuthService;
  let jwtService: JwtService;
  let passwordHash: string;
  let record: UserWithTenant;

  beforeAll(async () => {
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  });

  beforeEach(() => {
    repository = new FakeAuthRepository();
    jwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: 900 },
    });
    service = new AuthService(
      repository as unknown as AuthRepository,
      jwtService,
      new ConfigService({
        JWT_EXPIRES_IN: '15m',
        REFRESH_TOKEN_EXPIRES_IN: '7d',
      }),
    );
    record = repository.addUser({ email: 'ada@example.test', passwordHash });
  });

  it('login emite JWT y persiste únicamente el hash del refresh token', async () => {
    const session = await service.login({ email: ' ADA@example.test ', password: PASSWORD });

    expect(session.user).toMatchObject({
      id: record.user.id,
      email: record.user.email,
      tenantId: record.tenant.id,
      role: UserRole.TENANT_ADMIN,
    });
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);

    const stored = await repository.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
    expect(stored?.tokenHash).toBe(hashRefreshToken(session.refreshToken));
    expect(stored?.tokenHash).not.toBe(session.refreshToken);

    const payload = await jwtService.verifyAsync<{ sub: string; tenantId: string }>(
      session.accessToken,
    );
    expect(payload.sub).toBe(record.user.id);
    expect(payload.tenantId).toBe(record.tenant.id);
    expect(record.user.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rechaza credenciales inválidas sin revelar si el email existe', async () => {
    await expect(
      service.login({ email: 'no-existe@example.test', password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.login({ email: record.user.email, password: 'incorrecta' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza usuarios o tenants inactivos', async () => {
    record.user.status = UserStatus.BLOCKED;
    await expect(
      service.login({ email: record.user.email, password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    record.user.status = UserStatus.ACTIVE;
    record.tenant.status = TenantStatus.SUSPENDED;
    await expect(
      service.login({ email: record.user.email, password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('registra tenant/usuario y crea una sesión', async () => {
    const dto: RegisterDto = {
      email: 'Nueva@Example.test',
      password: PASSWORD,
      firstName: 'Grace',
      lastName: 'Hopper',
      companyName: 'Nueva Empresa',
      taxId: 'tax-nueva',
      country: 'CO',
      currency: 'COP',
    };

    const session = await service.register(dto);

    expect(session.user.email).toBe('nueva@example.test');
    expect(repository.usersByEmail.has('nueva@example.test')).toBe(true);
    expect(repository.tenantsByTaxId.has('tax-nueva')).toBe(true);
    expect(session.refreshToken).toBeTruthy();
  });

  it('rechaza email/taxId duplicado y errores únicos de PostgreSQL', async () => {
    await expect(
      service.register({
        email: record.user.email,
        password: PASSWORD,
        firstName: 'Grace',
        lastName: 'Hopper',
        companyName: 'Duplicada',
        taxId: 'tax-duplicada',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.register({
        email: 'otra@example.test',
        password: PASSWORD,
        firstName: 'Grace',
        lastName: 'Hopper',
        companyName: 'Duplicada',
        taxId: record.tenant.taxId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    repository.createFailure = { code: '23505' };
    await expect(
      service.register({
        email: 'race@example.test',
        password: PASSWORD,
        firstName: 'Grace',
        lastName: 'Hopper',
        companyName: 'Race',
        taxId: 'tax-race',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rota el refresh token preservando la familia e invalida el anterior', async () => {
    const first = await service.login({ email: record.user.email, password: PASSWORD });
    const firstToken = await repository.findRefreshTokenByHash(
      hashRefreshToken(first.refreshToken),
    );

    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.user.id).toBe(record.user.id);

    const oldStored = repository.tokens.get(firstToken!.id);
    const newStored = await repository.findRefreshTokenByHash(
      hashRefreshToken(second.refreshToken),
    );
    expect(oldStored?.isRevoked).toBe(true);
    expect(oldStored?.replacedByTokenId).toBe(newStored?.id);
    expect(newStored?.familyId).toBe(firstToken?.familyId);
  });

  it('detecta reuso, revoca la familia y rechaza la rotación', async () => {
    const first = await service.login({ email: record.user.email, password: PASSWORD });
    const oldToken = await repository.findRefreshTokenByHash(hashRefreshToken(first.refreshToken));
    await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.familyTokens(oldToken!.familyId).every((token) => token.isRevoked)).toBe(
      true,
    );
  });

  it('rechaza refresh desconocido, expirado o con usuario inactivo', async () => {
    await expect(service.refresh('token-inexistente')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const expired = generateRefreshToken(60_000);
    const expiredRow = repository.addRefreshToken({
      userId: record.user.id,
      tokenHash: expired.tokenHash,
      familyId: expired.familyId,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expect(service.refresh(expired.token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.tokens.get(expiredRow.id)?.isRevoked).toBe(true);

    record.user.status = UserStatus.INACTIVE;
    const active = await service
      .login({
        email: record.user.email,
        password: PASSWORD,
      })
      .catch(() => null);
    expect(active).toBeNull();

    record.user.status = UserStatus.ACTIVE;
    const valid = await service.login({ email: record.user.email, password: PASSWORD });
    record.user.status = UserStatus.INACTIVE;
    await expect(service.refresh(valid.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maneja errores de carrera al rotar y revoca la familia', async () => {
    const session = await service.login({ email: record.user.email, password: PASSWORD });
    const stored = await repository.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));
    repository.reuseOnRotate = true;

    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.familyTokens(stored!.familyId).every((token) => token.isRevoked)).toBe(true);
  });

  it('logout revoca la familia y es idempotente', async () => {
    const session = await service.login({ email: record.user.email, password: PASSWORD });
    const stored = await repository.findRefreshTokenByHash(hashRefreshToken(session.refreshToken));

    await expect(service.logout(session.refreshToken)).resolves.toEqual({ success: true });
    expect(repository.familyTokens(stored!.familyId).every((token) => token.isRevoked)).toBe(true);
    await expect(service.logout(session.refreshToken)).resolves.toEqual({ success: true });
    await expect(service.logout('inexistente')).resolves.toEqual({ success: true });
  });

  it('logoutAll revoca todas las sesiones del usuario y es idempotente', async () => {
    const first = await service.login({ email: record.user.email, password: PASSWORD });
    const second = await service.login({ email: record.user.email, password: PASSWORD });
    const other = repository.addUser({ email: 'otro@example.test', passwordHash });
    const otherSession = await service.login({ email: other.user.email, password: PASSWORD });

    const context = {
      userId: record.user.id,
      tenantId: record.tenant.id,
      email: record.user.email,
      role: UserRole.TENANT_ADMIN,
    };

    await expect(service.logoutAll(context)).resolves.toEqual({ success: true, revoked: 2 });

    const owned = [...repository.tokens.values()].filter(
      (token) => token.userId === record.user.id,
    );
    expect(owned).toHaveLength(2);
    expect(owned.every((token) => token.isRevoked)).toBe(true);

    const foreign = [...repository.tokens.values()].filter(
      (token) => token.userId === other.user.id,
    );
    expect(foreign.some((token) => token.isRevoked)).toBe(false);

    await expect(service.logoutAll(context)).resolves.toEqual({ success: true, revoked: 0 });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(otherSession.refreshToken).toBeTruthy();
  }, 15_000);

  it('logoutAll rechaza un contexto sin userId', async () => {
    await expect(
      service.logoutAll({
        userId: '',
        tenantId: record.tenant.id,
        email: record.user.email,
        role: UserRole.TENANT_ADMIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('devuelve el perfil y valida access tokens contra la base de datos', async () => {
    const session = await service.login({ email: record.user.email, password: PASSWORD });
    const profile = await service.getProfile({
      userId: record.user.id,
      tenantId: record.tenant.id,
      email: record.user.email,
      role: UserRole.TENANT_ADMIN,
    });

    expect(profile).toMatchObject({
      id: record.user.id,
      email: record.user.email,
      tenant: { id: record.tenant.id, legalName: record.tenant.legalName },
    });

    await expect(
      service.getProfile({
        userId: randomUUID(),
        tenantId: record.tenant.id,
        email: 'missing@example.test',
        role: UserRole.VIEWER,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const validation = await service.validateToken(session.accessToken);
    expect(validation.valid).toBe(true);
    expect(validation.user.userId).toBe(record.user.id);

    await expect(service.validateToken('token-invalido')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const token = await jwtService.signAsync({
      sub: randomUUID(),
      tenantId: record.tenant.id,
      email: 'missing@example.test',
      role: UserRole.VIEWER,
    });
    await expect(service.validateToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza el refresh si el tenant quedó inactivo', async () => {
    record.tenant.status = TenantStatus.SUSPENDED;
    const session = await service
      .login({ email: record.user.email, password: PASSWORD })
      .catch(() => null);
    expect(session).toBeNull();

    record.tenant.status = TenantStatus.ACTIVE;
    const valid = await service.login({ email: record.user.email, password: PASSWORD });
    record.tenant.status = TenantStatus.SUSPENDED;
    await expect(service.refresh(valid.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.getProfile({
        userId: record.user.id,
        tenantId: record.tenant.id,
        email: record.user.email,
        role: UserRole.TENANT_ADMIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.validateToken(valid.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
