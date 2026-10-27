import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// `.env` vive en la raíz del monorepo; los scripts se ejecutan desde apps/auth-service.
config({ path: resolve(__dirname, '../../.env') });
config();

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.AUTH_DATABASE_URL ??
      'postgresql://mybusiness_user:mybusiness_pass@localhost:5432/auth_db',
  },
  strict: true,
  verbose: true,
});
