import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { idempotencyRequests, sessions, type Db } from '@gunraid/db';
import { Queue, Worker } from 'bullmq';
import { lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { rkey } from '../../core/redis.js';
import { DB, ENV, REDIS } from '../../core/tokens.js';
import { PricesService } from '../catalog/prices.js';
import { GamesService } from '../games/games.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

const QUEUE = 'maintenance';
const HOUR = 60 * 60 * 1000;

/** Фоновые задачи воркера: сверка ledger, обновление цен, чистка сессий и ключей идемпотентности. */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ledger: LedgerService,
    private readonly prices: PricesService,
    private readonly games: GamesService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.env.REDIS_URL, maxRetriesPerRequest: null };
    const prefix = `${this.env.REDIS_PREFIX}bull`;
    this.queue = new Queue(QUEUE, { connection, prefix });
    await this.queue.upsertJobScheduler('cleanup', { every: HOUR }, { name: 'cleanup' });
    await this.queue.upsertJobScheduler('reconcile-ledger', { every: HOUR }, { name: 'reconcile-ledger' });
    await this.queue.upsertJobScheduler('refresh-prices', { every: 6 * HOUR }, { name: 'refresh-prices' });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        switch (job.name) {
          case 'cleanup':
            return this.cleanup();
          case 'reconcile-ledger':
            return this.reconcile();
          case 'refresh-prices':
            return this.refreshPrices();
          default:
            return undefined;
        }
      },
      { connection, prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.name} failed: ${err.message}`));
    this.logger.log('maintenance worker started');
  }

  async cleanup(): Promise<void> {
    const expired = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`now() - interval '7 days'`))
      .returning({ id: sessions.id });
    const keys = await this.db
      .delete(idempotencyRequests)
      .where(lt(idempotencyRequests.createdAt, sql`now() - interval '1 day'`))
      .returning({ key: idempotencyRequests.key });
    if (expired.length || keys.length) {
      this.logger.log(`cleanup: ${expired.length} sessions, ${keys.length} idempotency keys`);
    }
  }

  async reconcile(): Promise<number> {
    const mismatches = await this.ledger.reconcile();
    await this.redis.set(
      rkey(this.env, 'recon', 'last'),
      JSON.stringify({ checkedAt: new Date().toISOString(), mismatches }),
    );
    return mismatches.length;
  }

  async refreshPrices(): Promise<number> {
    let total = 0;
    for (const game of await this.games.listActive()) total += await this.prices.refresh(game);
    return total;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
