import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env by itself. Load the repo root .env when it exists (development).
// In Docker the variables come from docker-compose.yml instead.
const rootEnvFile = new URL('../../.env', import.meta.url);
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no database, so a missing DATABASE_URL is only an error for commands that connect.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
