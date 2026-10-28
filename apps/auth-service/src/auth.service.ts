import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  TenantStatus,
  UserRole,
  UserStatus,
  type AuthTokensResponse,
  type LoginDto,
  type RegisterDto,
  type UserContext,
} from '@mybusiness/contracts';
import { parseDurationToMs } from '@mybusiness/common';
import argon2 from 'argon2';
import {
  AuthRepository,
  RefreshTokenExpiredError,
  RefreshTokenReuseError,
  type UserWithTenant,
} from './auth.repository';
import { generateRefreshToken, hashRefreshToken } from './auth.tokens';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokensResponse> {
    const email = normalizeEmail(dto.email);
    const [existingUser, existingTenant] = await Promise.all([
      this.repository.findUserByEmail(email),
      this.repository.findTenantByTaxId(dto.taxId),
    ]);

    if (existingUser) {
      throw new ConflictException('El email ya está registrado.');
    }

    if (existingTenant) {
      throw new ConflictException('El taxId ya está registrado.');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      const { user, tenant } = await this.repository.createTenantAndUser({
        companyName: dto.companyName,
        taxId: dto.taxId,
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        country: dto.country,
        currency: dto.currency,
      });

      this.logger.log(`Tenant y usuario administrador registrados: ${user.id}`);
      return this.createSession({ user, tenant });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('El email o el taxId ya están registrados.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const email = normalizeEmail(dto.email);
    const record = await this.repository.findUserByEmail(email);

    if (!record) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordMatches = await argon2
      .verify(record.user.passwordHash, dto.password)
      .catch(() => false);

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (record.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('El usuario no está activo.');
    }

    if (record.tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('El tenant no está activo.');
    }

    await this.repository.updateLastLogin(record.user.id);
    this.logger.log(`Login exitoso para usuario: ${record.user.id}`);

    return this.createSession(record);
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponse> {
    const tokenHash = hashRefreshToken(refreshToken);
    const current = await this.repository.findRefreshTokenByHash(tokenHash);

    if (!current) {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    if (current.isRevoked) {
      await this.repository.revokeFamily(current.familyId);
      throw new UnauthorizedException('Refresh token reutilizado; sesión revocada.');
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      await this.repository.revokeToken(current.id);
      throw new UnauthorizedException('Refresh token expirado.');
    }

    const record = await this.repository.findUserById(current.userId);

    if (!record || record.user.status !== UserStatus.ACTIVE) {
      await this.repository.revokeFamily(current.familyId);
      throw new UnauthorizedException('Usuario no válido.');
    }

    if (record.tenant.status !== TenantStatus.ACTIVE) {
      await this.repository.revokeFamily(current.familyId);
      throw new UnauthorizedException('Tenant no válido.');
    }

    const ttlMs = parseDurationToMs(this.config.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_IN'));
    const next = generateRefreshToken(ttlMs, current.familyId);

    try {
      await this.repository.rotateRefreshToken(current.id, {
        userId: record.user.id,
        tokenHash: next.tokenHash,
        familyId: current.familyId,
        expiresAt: next.expiresAt,
      });
    } catch (error) {
      if (error instanceof RefreshTokenReuseError) {
        await this.repository.revokeFamily(current.familyId);
        throw new UnauthorizedException('Refresh token reutilizado; sesión revocada.');
      }

      if (error instanceof RefreshTokenExpiredError) {
        await this.repository.revokeToken(current.id);
        throw new UnauthorizedException('Refresh token expirado.');
      }

      throw error;
    }

    return {
      accessToken: await this.signAccessToken(record),
      refreshToken: next.token,
      user: this.mapUser(record),
    };
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    const tokenHash = hashRefreshToken(refreshToken);
    const current = await this.repository.findRefreshTokenByHash(tokenHash);

    if (current) {
      await this.repository.revokeFamily(current.familyId);
    }

    return { success: true };
  }

  async getProfile(context: UserContext) {
    const record = await this.repository.findUserById(context.userId);

    if (
      !record ||
      record.user.status !== UserStatus.ACTIVE ||
      record.tenant.status !== TenantStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Usuario o tenant no válido.');
    }

    return {
      ...this.mapUser(record),
      tenant: {
        id: record.tenant.id,
        legalName: record.tenant.legalName,
        tradeName: record.tenant.tradeName,
        currency: record.tenant.currency,
        timezone: record.tenant.timezone,
        status: record.tenant.status,
      },
    };
  }

  async validateToken(accessToken: string): Promise<{ valid: true; user: UserContext }> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(accessToken);
      const record = await this.repository.findUserById(payload.sub);

      if (
        !record ||
        record.user.status !== UserStatus.ACTIVE ||
        record.tenant.status !== TenantStatus.ACTIVE
      ) {
        throw new UnauthorizedException('Usuario o tenant no válido.');
      }

      return {
        valid: true,
        user: {
          userId: record.user.id,
          tenantId: record.user.tenantId,
          email: record.user.email,
          role: record.user.role as UserRole,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Access token inválido o expirado.');
    }
  }

  private async createSession(record: UserWithTenant): Promise<AuthTokensResponse> {
    const ttlMs = parseDurationToMs(this.config.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_IN'));
    const refresh = generateRefreshToken(ttlMs);

    await this.repository.createRefreshToken({
      userId: record.user.id,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      expiresAt: refresh.expiresAt,
    });

    return {
      accessToken: await this.signAccessToken(record),
      refreshToken: refresh.token,
      user: this.mapUser(record),
    };
  }

  private signAccessToken(record: UserWithTenant): Promise<string> {
    return this.jwtService.signAsync({
      sub: record.user.id,
      tenantId: record.user.tenantId,
      email: record.user.email,
      role: record.user.role,
    });
  }

  private mapUser(record: UserWithTenant): AuthTokensResponse['user'] {
    return {
      id: record.user.id,
      email: record.user.email,
      firstName: record.user.firstName,
      lastName: record.user.lastName,
      role: record.user.role as UserRole,
      tenantId: record.user.tenantId,
    };
  }
}
