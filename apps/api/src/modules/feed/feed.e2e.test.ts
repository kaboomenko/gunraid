import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { outboxEvents } from '@gunraid/db';
import type { CaseOpenResultDto, FeedDropDto, SiteStatsDto } from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreModule } from '../../core/core.module.js';
import { TestClient, createTestApp } from '../../test/app.js';
import { testEnv } from '../../test/env.js';
import { db, grantGems, newPlayer } from '../../test/fixtures.js';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeedWorkerModule } from './feed-worker.module.js';

@Module({})
class TestWorkerModule {}

let app: NestFastifyApplication;
let worker: INestApplicationContext;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Тикает воркер, пока событие игрока не обработано. Пачка — 100 событий по порядку id, а в очереди перед ним
 * могут стоять чужие (тестовая БД живёт между прогонами): число тиков от них не должно зависеть. Воркер тикает
 * и по своему таймеру (тогда tick() сразу возвращает 0) — поэтому опрос с пределом по времени.
 */
async function processUntilDone(type: string, userId: string, ms = 20_000): Promise<boolean> {
  const processor = worker.get(OutboxProcessor);
  const done = async () => {
    const rows = await db(app)
      .select({ processedAt: outboxEvents.processedAt })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.type, type), sql`${outboxEvents.payload}->>'userId' = ${userId}`));
    return rows.length > 0 && rows.every((r) => r.processedAt !== null);
  };
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (await done()) return true;
    if ((await processor.tick()) === 0) await sleep(50);
  }
  return done();
}

beforeAll(async () => {
  app = await createTestApp();
  worker = await NestFactory.createApplicationContext(
    { module: TestWorkerModule, imports: [CoreModule.forRoot(testEnv()), FeedWorkerModule] },
    { logger: false },
  );
  await app.get(SettingsService).set('feed', { minValueGems: 0, delayMs: 0 }, null);
});

afterAll(async () => {
  await app.get(SettingsService).set('feed', { minValueGems: 0, delayMs: 6000 }, null);
  await worker.close();
  await app.close();
});

describe('live feed via outbox (integration)', () => {
  it('publishes case drops to the game feed and counts opened cases', async () => {
    const { client, me } = await newPlayer(app, 'feed');
    await grantGems(app, me.id, 1000);
    const before = (await new TestClient(app).get<SiteStatsDto>('/api/v1/stats')).body.casesOpened;
    const opened = await client.post<CaseOpenResultDto>(
      '/api/v1/games/cs2/cases/stellar-start/open',
      { count: 2 },
      { 'idempotency-key': crypto.randomUUID() },
    );
    expect(opened.status).toBe(200);

    expect(await processUntilDone('case.opened', me.id)).toBe(true);

    const feed = await new TestClient(app).get<FeedDropDto[]>('/api/v1/games/cs2/feed');
    const ids = opened.body.results.map((r) => r.openingId);
    const mine = feed.body.filter((d) => ids.includes(d.id));
    expect(mine).toHaveLength(2);
    expect(mine[0]?.user.nickname).toBe(me.nickname);
    expect(mine[0]?.caseSlug).toBe('stellar-start');

    const after = (await new TestClient(app).get<SiteStatsDto>('/api/v1/stats')).body.casesOpened;
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });
});
