// Every other file in this project imports `env` from here instead of
// reading `process.env` directly. Two reasons:
//   1. `process.env.PORT` is typed as `string | undefined` everywhere you
//      touch it — that's not useful. Parsing it once with Zod gives the rest
//      of the app a real `number`.
//   2. If a required variable is missing or malformed, we want the app to
//      refuse to start with a clear message, not crash three requests later
//      when some deeply-nested service finally touches `undefined`.
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  CORS_ORIGIN: z.url({ error: 'CORS_ORIGIN must be a valid URL, e.g. http://localhost:5173' }).default(
    'http://localhost:5173',
  ),
  COOKIE_DOMAIN: z.string().trim().optional(),

  DATABASE_URL: z.string().min(1, { error: 'DATABASE_URL is required.' }),

  REDIS_URL: z.string().min(1, { error: 'REDIS_URL is required.' }),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, { error: 'JWT_ACCESS_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`.' }),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, { error: 'JWT_REFRESH_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`.' }),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  GEMINI_API_KEY: z.string().min(1, { error: 'GEMINI_API_KEY is required.' }),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
