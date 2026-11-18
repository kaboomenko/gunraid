import { Inject, Injectable } from '@nestjs/common';
import { newId, notifications, type Db, type DbOrTx } from '@gunraid/db';
import {
  WS_EVENTS,
  type NotificationDto,
  type NotificationsDto,
  type NotificationType,
} from '@gunraid/shared';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { OutboxService } from '../outbox/outbox.service.js';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  params?: Record<string, string | number>;
  link?: string | null;
}

type Row = typeof notifications.$inferSelect;

function toDto(r: Row): NotificationDto {
  return {
    id: r.id,
    type: r.type as NotificationType,
    params: r.params,
    link: r.link,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Уведомления (колокольчик). Из игровых транзакций — через outbox (enqueue), чтобы уведомление
 * появлялось только после коммита; из воркера — сразу (create).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  enqueue(tx: DbOrTx, input: NotificationInput): Promise<void> {
    return this.outbox.add(tx, 'notification.create', input as unknown as Record<string, unknown>);
  }

  async create(input: NotificationInput): Promise<NotificationDto> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        id: newId(),
        userId: input.userId,
        type: input.type,
        params: input.params ?? {},
        link: input.link ?? null,
      })
      .returning();
    const dto = toDto(row!);
    this.realtime.toUser(input.userId, WS_EVENTS.notificationNew, dto);
    return dto;
  }

  async list(userId: string, limit = 30): Promise<NotificationsDto> {
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      this.db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);
    return { items: rows.map(toDto), unread: agg?.n ?? 0 };
  }

  async markRead(userId: string, ids?: string[]): Promise<{ unread: number }> {
    const where = [eq(notifications.userId, userId), isNull(notifications.readAt)];
    if (ids?.length) where.push(inArray(notifications.id, ids));
    await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(...where));
    const [agg] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { unread: agg?.n ?? 0 };
  }
}
