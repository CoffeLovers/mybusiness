import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuthDatabaseService } from './database/database.service';
import {
  refreshTokens,
  tenants,
  users,
  type NewRefreshToken,
  type RefreshToken,
  type Tenant,
  type User,
} from './database/schema';

export interface UserWithTenant {
  user: User;
  tenant: Tenant;
}

export interface CreateTenantUserInput {
  companyName: string;
  taxId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  country?: string;
  currency?: string;
}

export class RefreshTokenReuseError extends Error {
  constructor() {
    super('Refresh token ya revocado: posible reuso.');
    this.name = RefreshTokenReuseError.name;
  }
}

export class RefreshTokenExpiredError extends Error {
  constructor() {
    super('Refresh token expirado.');
    this.name = RefreshTokenExpiredError.name;
  }
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: AuthDatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async findUserByEmail(email: string): Promise<UserWithTenant | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return null;
    }

    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, user.tenantId), isNull(tenants.deletedAt)))
      .limit(1);

    return tenant ? { user, tenant } : null;
  }

  async findUserById(userId: string): Promise<UserWithTenant | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return null;
    }

    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, user.tenantId), isNull(tenants.deletedAt)))
      .limit(1);

    return tenant ? { user, tenant } : null;
  }

  async findTenantByTaxId(taxId: string): Promise<Tenant | null> {
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.taxId, taxId), isNull(tenants.deletedAt)))
      .limit(1);

    return tenant ?? null;
  }

  async createTenantAndUser(input: CreateTenantUserInput): Promise<UserWithTenant> {
    return this.db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          legalName: input.companyName,
          tradeName: input.companyName,
          taxId: input.taxId,
          ...(input.country ? { country: input.country } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
        })
        .returning();

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          role: 'TENANT_ADMIN',
        })
        .returning();

      return { user, tenant };
    });
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  async createRefreshToken(input: NewRefreshToken): Promise<RefreshToken> {
    const [token] = await this.db.insert(refreshTokens).values(input).returning();
    return token;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    const [token] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return token ?? null;
  }

  async rotateRefreshToken(
    currentTokenId: string,
    nextToken: NewRefreshToken,
  ): Promise<RefreshToken> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, currentTokenId))
        .for('update');

      if (!current) {
        throw new RefreshTokenExpiredError();
      }

      if (current.isRevoked) {
        throw new RefreshTokenReuseError();
      }

      if (current.expiresAt.getTime() <= Date.now()) {
        throw new RefreshTokenExpiredError();
      }

      const [created] = await tx.insert(refreshTokens).values(nextToken).returning();

      await tx
        .update(refreshTokens)
        .set({
          isRevoked: true,
          revokedAt: new Date(),
          replacedByTokenId: created.id,
        })
        .where(eq(refreshTokens.id, current.id));

      return created;
    });
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, tokenId), eq(refreshTokens.isRevoked, false)));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), eq(refreshTokens.isRevoked, false)));
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const revoked = await this.db
      .update(refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.isRevoked, false)))
      .returning({ id: refreshTokens.id });

    return revoked.length;
  }
}
