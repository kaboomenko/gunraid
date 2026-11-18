import { describe, expect, it } from 'vitest';
import { testEnv } from '../test/env.js';
import { loadEnv } from './env.js';

describe('env', () => {
  it('treats an empty DB_POOL_SIZE as "use the default" (docker compose passes empty values)', () => {
    expect(testEnv({ DB_POOL_SIZE: '' }).DB_POOL_SIZE).toBeUndefined();
    expect(testEnv({ DB_POOL_SIZE: '7' }).DB_POOL_SIZE).toBe(7);
  });

  it('has safe pool timeouts by default', () => {
    const { DB_POOL_ACQUIRE_TIMEOUT_MS: _a, DB_IDLE_IN_TX_TIMEOUT_MS: _b, ...base } = testEnv();
    const env = loadEnv(
      Object.fromEntries(
        Object.entries(base)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    );
    expect(env.DB_POOL_ACQUIRE_TIMEOUT_MS).toBe(10_000);
    expect(env.DB_IDLE_IN_TX_TIMEOUT_MS).toBe(60_000);
  });

  it('refuses development secrets in production', () => {
    expect(() =>
      testEnv({ APP_ENV: 'production', JWT_ACCESS_SECRET: 'dev-only-' + 'x'.repeat(40) }),
    ).toThrow(/development secrets/);
  });
});
