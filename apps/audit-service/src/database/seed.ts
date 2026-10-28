import { config } from 'dotenv';
import { resolve } from 'node:path';

// El `.env` vive en la raíz del monorepo; el script se ejecuta desde apps/audit-service.
config({ path: resolve(__dirname, '../../../../.env') });
config();

import { and, eq } from 'drizzle-orm';
import { createDatabase } from './client';
import { auditLogs } from './schema';

function getEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

async function seed(): Promise<void> {
  const defaultTenantId = getEnvOrDefault(
    'SEED_AUDIT_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );

  const { db, pool } = createDatabase();

  try {
    // audit_logs es append-only (los triggers bloquean UPDATE y DELETE),
    // así que la idempotencia se garantiza leyendo antes de insertar.
    const [existingSeed] = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, defaultTenantId), eq(auditLogs.entityId, 'seed')))
      .limit(1);

    if (existingSeed) {
      console.log('Seed de audit-service ya aplicado para tenant:', defaultTenantId);
      return;
    }

    await db.insert(auditLogs).values([
      {
        tenantId: defaultTenantId,
        action: 'system.bootstrap',
        entityName: 'System',
        entityId: 'seed',
        newValues: { message: 'Inicialización de esquema de auditoría completada (Seed)' },
        ipAddress: '127.0.0.1',
        userAgent: 'system-seeder/1.0',
      },
      {
        tenantId: defaultTenantId,
        action: 'auth.user_created',
        entityName: 'User',
        entityId: 'seed-admin',
        newValues: { role: 'TENANT_ADMIN', note: 'Registro de auditoría demo' },
        ipAddress: '127.0.0.1',
        userAgent: 'system-seeder/1.0',
      },
    ]);

    console.log('Seed de audit-service completado para tenant:', defaultTenantId);
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Error ejecutando seed de audit-service:', error);
  process.exitCode = 1;
});
