// Prisma 7's default "prisma-client" generator is Rust-free: it no longer
// ships a compiled query-engine binary, which means PrismaClient can no
// longer talk to Postgres by itself. You now hand it a *driver adapter* —
// here, @prisma/adapter-pg, which wraps the battle-tested `pg` driver.
//
// Beginner instinct:  `const prisma = new PrismaClient();`
// Prisma 7 requirement: `const prisma = new PrismaClient({ adapter });`
// Skipping the adapter doesn't throw a friendly error either — queries just
// hang or reject with a driver-not-found error, so this is worth knowing
// before you're debugging it at 1am.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const adapter = new PrismaPg(env.DATABASE_URL);

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('PostgreSQL connected via Prisma');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
