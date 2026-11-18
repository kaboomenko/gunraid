import { loadEnv, type Env } from '../config/env.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://gunraid:gunraid@localhost:5432/gunraid_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PUBLIC_URL: 'http://localhost:8080',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    REDIS_PREFIX: 'test:',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghijkl',
    COOKIE_SECRET: 'test-cookie-secret-0123456789abcdefghijkl',
    FAIR_SEED_KEY: 'ab'.repeat(32),
    PAYMENT_MOCK_SECRET: 'test-mock-secret',
    AUTH_DEV_LOGIN: 'true',
    TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN',
    TELEGRAM_BOT_USERNAME: 'gunraid_test_bot',
    LOG_LEVEL: 'silent',
    TRUST_PROXY: 'false',
    ...overrides,
  });
}
