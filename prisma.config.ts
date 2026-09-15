// Prisma 7 moved CLI configuration (schema location, migrations folder, the
// `db seed` command, and the connection string used by the CLI) out of
// schema.prisma / package.json and into this dedicated config file.
// Anthropic note for readers of this file: this is NOT optional boilerplate —
// `prisma generate` / `prisma migrate` / `prisma db seed` will not run
// without it in Prisma 7.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
