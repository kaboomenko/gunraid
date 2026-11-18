import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Db } from '@gunraid/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DB } from '../../core/tokens.js';
import { createTestApp } from '../../test/app.js';
import { testEnv } from '../../test/env.js';
import { SettingsService } from './settings.service.js';

/**
 * Регрессия: get() вызывается внутри транзакций. Раньше при устаревшем кэше он брал второе
 * соединение пула — под нагрузкой все соединения держали транзакции и ждали друг друга (API вставал).
 * Здесь пул из одного соединения: любое такое ожидание упирается в таймаут.
 */
describe('settings (integration)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await createTestApp(testEnv({ DB_POOL_SIZE: '1', DB_POOL_ACQUIRE_TIMEOUT_MS: '1500' }));
  });
  afterAll(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('get() inside a transaction never waits for a second pool connection, even when stale', async () => {
    const settings = app.get(SettingsService);
    const db = app.get<Db>(DB);
    const fresh = await settings.get('feed');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000); // кэш устарел
    const inTx = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      return settings.get('feed');
    });
    vi.useRealTimers();
    expect(inTx).toEqual(fresh);
  });

  it('set() is visible immediately in this process and survives a refresh', async () => {
    const settings = app.get(SettingsService);
    const before = await settings.get('feed');
    try {
      await settings.set('feed', { ...before, delayMs: before.delayMs + 1 }, null);
      expect((await settings.get('feed')).delayMs).toBe(before.delayMs + 1);
      await settings.preload();
      expect((await settings.get('feed')).delayMs).toBe(before.delayMs + 1);
    } finally {
      await settings.set('feed', before, null);
    }
  });
});
