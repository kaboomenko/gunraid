import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CaseOpenResultDto, FeedDropDto, SiteStatsDto } from '@gunraid/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreModule } from '../../core/core.module.js';
import { TestClient, createTestApp } from '../../test/app.js';
import { testEnv } from '../../test/env.js';
import { grantGems, newPlayer } from '../../test/fixtures.js';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeedWorkerModule } from './feed-worker.module.js';

@Module({})
class TestWorkerModule {}

let app: NestFastifyApplication;
let worker: INestApplicationContext;

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

    const processor = worker.get(OutboxProcessor);
    for (let i = 0; i < 5; i++) await processor.tick();

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
