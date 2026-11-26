import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { outboxEvents, type Db } from '@gunraid/db';
import { eq, sql } from 'drizzle-orm';
import { errorText } from '../../common/pg-errors.js';
import { DB } from '../../core/tokens.js';

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

const POLL_MS = 500;
const BATCH = 100;
/** Аренда захваченных событий: если процесс упал посреди пачки, события вернутся через это время. */
const LEASE_SEC = 60;

/**
 * Воркер: забирает готовые события (available_at ≤ now) пачками с SKIP LOCKED и раздаёт обработчикам.
 * Захват — одним коротким запросом с арендой (транзакция не держится, пока работают обработчики:
 * они сами берут соединения из пула). Ошибка обработчика — повтор с экспоненциальной задержкой;
 * событие не теряется при падении процесса (доставка «хотя бы раз», обработчики идемпотентны).
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
      const res = await this.db.execute(sql`
        update outbox_events o
        set available_at = now() + make_interval(secs => ${LEASE_SEC})
        from (
          select id from outbox_events
          where processed_at is null and available_at <= now()
          order by id
          limit ${BATCH}
          for update skip locked
        ) claimed
        where o.id = claimed.id
        returning o.id, o.type, o.payload, o.attempts
      `);
      const rows = (
        res.rows as Array<{
          id: number;
          type: string;
          payload: Record<string, unknown>;
          attempts: number;
        }>
      ).sort((a, b) => Number(a.id) - Number(b.id));
      for (const row of rows) {
        if (this.stopped) break; // остальные вернутся после аренды
        try {
          for (const handler of this.handlers.get(row.type) ?? []) await handler(row.payload);
          await this.db
            .update(outboxEvents)
            .set({ processedAt: sql`now()` })
            .where(eq(outboxEvents.id, Number(row.id)));
        } catch (err) {
          const attempts = row.attempts + 1;
          const backoffSec = Math.min(3600, 2 ** attempts);
          // Причина без SQL и параметров упавшего запроса (там бывают id игроков и исход розыгрыша).
          const reason = errorText(err);
          this.logger.warn(`outbox ${row.type}#${row.id} failed (attempt ${attempts}): ${reason}`);
          await this.db
            .update(outboxEvents)
            .set({
              attempts,
              lastError: reason.slice(0, 500),
              availableAt: sql`now() + make_interval(secs => ${backoffSec})`,
            })
            .where(eq(outboxEvents.id, Number(row.id)));
        }
      }
      return rows.length;
    } catch (err) {
      this.logger.error(`outbox tick failed: ${errorText(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
