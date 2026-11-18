import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1');
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production', 'test']).default('local'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_PREFIX: z.string().default('gr:'),
  JWT_ACCESS_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  FAIR_SEED_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  PAYMENT_MOCK_SECRET: z.string().min(8),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(true),
  AUTH_DEV_LOGIN: bool.default(false),
  STEAM_API_KEY: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_BOT_USERNAME: optional,
  CORS_ORIGINS: optional,
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STORAGE_DIR: z.string().default('./storage'),
});

export type Env = z.infer<typeof envSchema>;

const DEV_SECRET_RE = /^dev-only/;

export function loadEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Env {
  const env = envSchema.parse(source);
  if (env.APP_ENV === 'production') {
    const weak =
      DEV_SECRET_RE.test(env.JWT_ACCESS_SECRET) ||
      DEV_SECRET_RE.test(env.COOKIE_SECRET) ||
      DEV_SECRET_RE.test(env.PAYMENT_MOCK_SECRET) ||
      /^0+$/.test(env.FAIR_SEED_KEY);
    if (weak)
      throw new Error('Refusing to start: development secrets are used with APP_ENV=production');
  }
  return env;
}

/** Dev-вход разрешён только явно и никогда в production. */
export function isDevLoginEnabled(env: Env): boolean {
  return env.AUTH_DEV_LOGIN && env.APP_ENV !== 'production';
}

export function isGoogleEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isTelegramEnabled(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);
}
