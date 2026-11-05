import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// El `.env` vive en la raíz del monorepo; el script se ejecuta desde apps/auth-service.
config({ path: resolve(__dirname, '../../../../.env') });
config();

import argon2 from 'argon2';
import { UserRole, UserStatus } from '@mybusiness/contracts';
import { createDatabase } from './client';
import { tenants, users } from './schema';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`${name} es obligatoria para ejecutar el seed de desarrollo.`);
  }

  return value;
}

async function seed(): Promise<void> {
  const tenantTaxId = requiredEnv('SEED_TENANT_TAX_ID');
  const tenantLegalName = requiredEnv('SEED_TENANT_LEGAL_NAME');
  const tenantTradeName = requiredEnv('SEED_TENANT_TRADE_NAME');
  const tenantCountry = requiredEnv('SEED_TENANT_COUNTRY');
  const tenantCurrency = requiredEnv('SEED_TENANT_CURRENCY');
  const tenantTimezone = requiredEnv('SEED_TENANT_TIMEZONE');
  const tenantLocale = requiredEnv('SEED_TENANT_LOCALE');
  const adminEmail = requiredEnv('SEED_ADMIN_EMAIL');
  const adminPassword = requiredEnv('SEED_ADMIN_PASSWORD');
  const adminFirstName = requiredEnv('SEED_ADMIN_FIRST_NAME');
  const adminLastName = requiredEnv('SEED_ADMIN_LAST_NAME');

  const { db, pool } = createDatabase();

  try {
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

    const [seededTenant] = await db
      .insert(tenants)
      .values({
        legalName: tenantLegalName,
        tradeName: tenantTradeName,
        taxId: tenantTaxId,
        country: tenantCountry,
        currency: tenantCurrency,
        timezone: tenantTimezone,
        settings: { locale: tenantLocale, demo: true },
      })
      .onConflictDoUpdate({
        target: tenants.taxId,
        set: {
          legalName: tenantLegalName,
          tradeName: tenantTradeName,
          country: tenantCountry,
          currency: tenantCurrency,
          timezone: tenantTimezone,
          settings: { locale: tenantLocale, demo: true },
        },
      })
      .returning({ id: tenants.id });

    const tenantId = seededTenant?.id;

    if (!tenantId) {
      throw new Error('No fue posible crear ni recuperar el tenant de demostración');
    }

    await db
      .insert(users)
      .values({
        tenantId,
        email: adminEmail,
        passwordHash,
        firstName: adminFirstName,
        lastName: adminLastName,
        role: UserRole.TENANT_ADMIN,
        status: UserStatus.ACTIVE,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          tenantId,
          passwordHash,
          firstName: adminFirstName,
          lastName: adminLastName,
          role: UserRole.TENANT_ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      });

    console.log('Seed completado:', { tenantId, email: adminEmail });
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Error ejecutando el seed:', error);
  process.exitCode = 1;
});
