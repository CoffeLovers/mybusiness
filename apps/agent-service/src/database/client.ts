import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Crea una conexión a `agent_db`. Se expone como factory para que los tests
 * puedan inyectar una URL distinta y para no abrir conexiones al importar.
 */
export function createDatabase(connectionString = process.env.AGENT_DATABASE_URL) {
  if (!connectionString) {
    throw new Error('AGENT_DATABASE_URL no está definida');
  }

  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });

  return { db, pool };
}

export type AgentDatabase = ReturnType<typeof createDatabase>['db'];
