import { config } from 'dotenv';
import { resolve } from 'node:path';

// El `.env` vive en la raíz del monorepo; el script se ejecuta desde apps/agent-service.
config({ path: resolve(__dirname, '../../../../.env') });
config();

import { ContextType } from '@mybusiness/contracts';
import { createDatabase } from './client';
import { agentMemories } from './schema';

function getEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

/**
 * Genera un vector normalizado de `dimensions` dimensiones para pruebas de pgvector.
 */
function createNormalizedVector(dimensions = 1536, seedVal = 0.5): number[] {
  const vec = new Array<number>(dimensions);
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) {
    const val = Math.sin(i * seedVal + 1);
    vec[i] = val;
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

async function seed(): Promise<void> {
  const defaultTenantId = getEnvOrDefault(
    'SEED_AGENT_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );

  const { db, pool } = createDatabase();

  try {
    const embedding1 = createNormalizedVector(1536, 0.42);
    const embedding2 = createNormalizedVector(1536, 0.84);

    await db.insert(agentMemories).values([
      {
        tenantId: defaultTenantId,
        content:
          'Regla de negocio: El IVA general en Colombia es del 19% aplicable a servicios gravados.',
        contextType: ContextType.FINANCIAL_RULE,
        embedding: embedding1,
        metadata: { category: 'tax', country: 'CO', law: 'Estatuto Tributario' },
      },
      {
        tenantId: defaultTenantId,
        content:
          'Preferencia del usuario: Enviar reportes de flujo de caja todos los viernes en moneda COP.',
        contextType: ContextType.USER_PREFERENCE,
        embedding: embedding2,
        metadata: { frequency: 'weekly', preferredDay: 'FRIDAY' },
      },
    ]);

    console.log('Seed de agent-service completado para tenant:', defaultTenantId);
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Error ejecutando seed de agent-service:', error);
  process.exitCode = 1;
});
