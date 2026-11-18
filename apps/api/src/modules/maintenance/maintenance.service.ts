import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sessions, type Db } from '@gunraid/db';
import { Queue, Worker } from 'bullmq';
import { lt, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { DB, ENV } from '../../core/tokens.js';

const QUEUE = 'maintenance';

/** Фоновые задачи обслуживания (воркер): чистка истёкших сессий и т.п. */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.env.REDIS_URL, maxRetriesPerRequest: null };
    const prefix = `${this.env.REDIS_PREFIX}bull`;
    this.queue = new Queue(QUEUE, { connection, prefix });
    await this.queue.upsertJobScheduler('cleanup-sessions', { every: 60 * 60 * 1000 }, { name: 'cleanup-sessions' });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'cleanup-sessions') return this.cleanupSessions();
        return undefined;
      },
      { connection, prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.name} failed: ${err.message}`));
    this.logger.log('maintenance worker started');
  }

  async cleanupSessions(): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`now() - interval '7 days'`))
      .returning({ id: sessions.id });
    if (rows.length) this.logger.log(`removed ${rows.length} expired sessions`);
    return rows.length;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
