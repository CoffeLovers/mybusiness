import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// `.env` vive en la raíz del monorepo; los scripts se ejecutan desde apps/auth-service.
config({ path: resolve(__dirname, '../../.env') });
config();

const databaseUrl = process.env.AUTH_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('AUTH_DATABASE_URL es obligatoria para ejecutar drizzle-kit.');
}

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
