import { config } from 'dotenv';
import { resolve } from 'node:path';

// El `.env` vive en la raíz del monorepo; el script se ejecuta desde apps/auth-service.
config({ path: resolve(__dirname, '../../../../.env') });
config();

import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client';
import { tenants, users } from './schema';

const DEMO_TAX_ID = '900123456-7';
const DEMO_EMAIL = 'admin@mybusiness.demo';
const DEMO_PASSWORD = 'Demo1234!';

async function seed(): Promise<void> {
  const { db, pool } = createDatabase();

  try {
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

    const [insertedTenant] = await db
      .insert(tenants)
      .values({
        legalName: 'MyBusiness Demo S.A.S.',
        tradeName: 'MyBusiness Demo',
        taxId: DEMO_TAX_ID,
        country: 'CO',
        currency: 'COP',
        timezone: 'America/Bogota',
        settings: { locale: 'es-CO', demo: true },
      })
      .onConflictDoNothing({ target: tenants.taxId })
      .returning({ id: tenants.id });

    const tenantId =
      insertedTenant?.id ??
      (
        await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.taxId, DEMO_TAX_ID))
          .limit(1)
      )[0]?.id;

    if (!tenantId) {
      throw new Error('No fue posible crear ni recuperar el tenant de demostración');
    }

    await db
      .insert(users)
      .values({
        tenantId,
        email: DEMO_EMAIL,
        passwordHash,
        firstName: 'Admin',
        lastName: 'Demo',
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
      })
      .onConflictDoNothing({ target: users.email });

    console.log('Seed completado:', { tenantId, email: DEMO_EMAIL, password: DEMO_PASSWORD });
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Error ejecutando el seed:', error);
  process.exitCode = 1;
});
