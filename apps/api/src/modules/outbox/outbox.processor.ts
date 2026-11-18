import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { outboxEvents, type Db } from '@gunraid/db';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

const POLL_MS = 500;
const BATCH = 100;

/**
 * Воркер: забирает готовые события (available_at ≤ now) пачками с SKIP LOCKED и раздаёт обработчикам.
 * Ошибка обработчика — повтор с экспоненциальной задержкой; событие не теряется при падении процесса.
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxProcessor.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(@Inject(DB) private readonly db: Db) {}

  on(type: string, handler: OutboxHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      return await this.db.transaction(async (tx) => {
        const res = await tx.execute(sql`
          select id, type, payload, attempts from outbox_events
          where processed_at is null and available_at <= now()
          order by id
          limit ${BATCH}
          for update skip locked
        `);
        const rows = res.rows as Array<{
          id: number;
          type: string;
          payload: Record<string, unknown>;
          attempts: number;
        }>;
        for (const row of rows) {
          try {
            for (const handler of this.handlers.get(row.type) ?? []) await handler(row.payload);
            await tx
              .update(outboxEvents)
              .set({ processedAt: sql`now()` })
              .where(eq(outboxEvents.id, Number(row.id)));
          } catch (err) {
            const attempts = row.attempts + 1;
            const backoffSec = Math.min(3600, 2 ** attempts);
            this.logger.warn(
              `outbox ${row.type}#${row.id} failed (attempt ${attempts}): ${(err as Error).message}`,
            );
            await tx
              .update(outboxEvents)
              .set({
                attempts,
                lastError: (err as Error).message.slice(0, 500),
                availableAt: sql`now() + make_interval(secs => ${backoffSec})`,
              })
              .where(eq(outboxEvents.id, Number(row.id)));
          }
        }
        return rows.length;
      });
    } catch (err) {
      this.logger.error(`outbox tick failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
