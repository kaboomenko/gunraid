import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  leaderboardPayouts,
  leaderboardPeriods,
  leaderboards,
  newId,
  users,
  type Db,
  type LeaderboardPrize,
  type LeaderboardStanding,
} from '@gunraid/db';
import type {
  LeaderboardDto,
  LeaderboardEntryDto,
  LeaderboardPeriod,
  LeaderboardsDto,
} from '@gunraid/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import type { GameRow } from '../games/games.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

const DAY = 24 * 60 * 60 * 1000;
const TOP = 20;
/** Метрика: сумма стоимости предметов, полученных в режимах (без бонусных и проигранных в баттлах). */
const SOURCES = sql`('case','upgrade','contract','battle')`;

type LeaderboardRow = typeof leaderboards.$inferSelect;

/** Границы периода в часовом поясе сайта: день — с полуночи, неделя — с понедельника. */
export function periodBounds(
  period: LeaderboardPeriod,
  now: number,
  offsetMinutes: number,
): { start: Date; end: Date } {
  const off = offsetMinutes * 60_000;
  const dayIndex = Math.floor((now + off) / DAY);
  if (period === 'day') {
    return { start: new Date(dayIndex * DAY - off), end: new Date((dayIndex + 1) * DAY - off) };
  }
  // 1970-01-01 — четверг: (dayIndex + 3) % 7 = 0 для понедельника.
  const weekday = (dayIndex + 3) % 7;
  const startDay = dayIndex - weekday;
  return { start: new Date(startDay * DAY - off), end: new Date((startDay + 7) * DAY - off) };
}

export function prizeFor(prizes: LeaderboardPrize[], place: number): number {
  return prizes.find((p) => place >= p.from && place <= p.to)?.amount ?? 0;
}

/** Лидерборды за день и неделю: топ по сумме дропов, призы победителям по итогам периода. */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async standings(
    gameId: number,
    start: Date,
    end: Date,
    limit = TOP,
  ): Promise<LeaderboardStanding[]> {
    const res = await this.db.execute(sql`
      select user_id, sum(acquired_value)::bigint as value
      from user_items
      where game_id = ${gameId} and acquired_at >= ${start} and acquired_at < ${end}
        and source_type in ${SOURCES} and status <> 'lost_battle'
      group by user_id
      order by value desc, min(acquired_at) asc
      limit ${limit}
    `);
    return (res.rows as Array<{ user_id: string; value: string | number }>).map((r, i) => ({
      place: i + 1,
      userId: r.user_id,
      value: Number(r.value),
    }));
  }

  private async myPlace(
    gameId: number,
    start: Date,
    end: Date,
    userId: string,
  ): Promise<{ place: number | null; value: number }> {
    const res = await this.db.execute(sql`
      with totals as (
        select user_id, sum(acquired_value)::bigint as value
        from user_items
        where game_id = ${gameId} and acquired_at >= ${start} and acquired_at < ${end}
          and source_type in ${SOURCES} and status <> 'lost_battle'
        group by user_id
      )
      select (select value from totals where user_id = ${userId}) as value,
             (select count(*) from totals where value > coalesce((select value from totals where user_id = ${userId}), -1))::int as above
    `);
    const row = res.rows[0] as { value: string | null; above: number } | undefined;
    if (!row?.value) return { place: null, value: 0 };
    return { place: row.above + 1, value: Number(row.value) };
  }

  private async withUsers(
    standings: LeaderboardStanding[],
    prizes: LeaderboardPrize[],
  ): Promise<LeaderboardEntryDto[]> {
    if (!standings.length) return [];
    const rows = await this.db
      .select({
        id: users.id,
        shortId: users.shortId,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
        level: users.level,
      })
      .from(users)
      .where(
        inArray(
          users.id,
          standings.map((s) => s.userId),
        ),
      );
    const map = new Map(rows.map((r) => [r.id, r]));
    return standings.flatMap((s) => {
      const u = map.get(s.userId);
      return u
        ? [
            {
              place: s.place,
              user: {
                shortId: u.shortId,
                nickname: u.nickname,
                avatarUrl: u.avatarUrl,
                level: u.level,
              },
              value: s.value,
              prize: prizeFor(prizes, s.place),
            },
          ]
        : [];
    });
  }

  private async board(lb: LeaderboardRow, userId: string | null): Promise<LeaderboardDto> {
    const site = await this.settings.get('site');
    const { start, end } = periodBounds(lb.period, Date.now(), site.dayUtcOffsetMinutes);
    const [standings, me, [prev]] = await Promise.all([
      this.standings(lb.gameId, start, end),
      userId ? this.myPlace(lb.gameId, start, end, userId) : Promise.resolve(null),
      this.db
        .select()
        .from(leaderboardPeriods)
        .where(
          and(
            eq(leaderboardPeriods.leaderboardId, lb.id),
            eq(leaderboardPeriods.status, 'finalized'),
          ),
        )
        .orderBy(desc(leaderboardPeriods.periodStart))
        .limit(1),
    ]);
    return {
      period: lb.period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      prizes: lb.prizes,
      top: await this.withUsers(standings, lb.prizes),
      me,
      previous: await this.withUsers((prev?.standings ?? []).slice(0, 3), lb.prizes),
    };
  }

  async get(game: GameRow, userId: string | null): Promise<LeaderboardsDto> {
    const rows = await this.db
      .select()
      .from(leaderboards)
      .where(and(eq(leaderboards.gameId, game.id), eq(leaderboards.isActive, true)));
    const day = rows.find((r) => r.period === 'day');
    const week = rows.find((r) => r.period === 'week');
    return {
      day: day ? await this.board(day, userId) : null,
      week: week ? await this.board(week, userId) : null,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Подведение итогов завершившихся периодов (воркер, раз в минуту). Идемпотентно:
   * строка периода уникальна по (лидерборд, начало), призы — с ключами идемпотентности.
   */
  async finalizeDue(now = Date.now()): Promise<number> {
    const site = await this.settings.get('site');
    const active = await this.db.select().from(leaderboards).where(eq(leaderboards.isActive, true));
    let done = 0;
    for (const lb of active) {
      const current = periodBounds(lb.period, now, site.dayUtcOffsetMinutes);
      const prevAt = current.start.getTime() - 1;
      const prev = periodBounds(lb.period, prevAt, site.dayUtcOffsetMinutes);
      try {
        if (await this.finalize(lb, prev.start, prev.end)) done++;
      } catch (err) {
        this.logger.error(`leaderboard ${lb.id} finalize failed: ${(err as Error).message}`);
      }
    }
    return done;
  }

  async finalize(lb: LeaderboardRow, start: Date, end: Date): Promise<boolean> {
    const maxPlace = Math.max(10, ...lb.prizes.map((p) => p.to));
    const standings = await this.standings(lb.gameId, start, end, maxPlace);
    const paid: Array<{ userId: string; place: number; amount: number }> = [];
    const created = await this.db.transaction(async (tx) => {
      const periodId = newId();
      const inserted = await tx
        .insert(leaderboardPeriods)
        .values({
          id: periodId,
          leaderboardId: lb.id,
          periodStart: start,
          periodEnd: end,
          status: 'finalized',
          standings,
          finalizedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: leaderboardPeriods.id });
      if (!inserted.length) return false;
      const winners = standings
        .map((s) => ({ ...s, amount: prizeFor(lb.prizes, s.place) }))
        .filter((s) => s.amount > 0)
        .sort((a, b) => (a.userId < b.userId ? -1 : 1)); // кошельки — в порядке id
      for (const w of winners) {
        const res = await this.ledger.post(tx, {
          userId: w.userId,
          type: 'leaderboard_prize',
          amount: w.amount,
          refType: 'leaderboard_period',
          refId: periodId,
          idempotencyKey: `leaderboard:${periodId}:${w.place}`,
          meta: { period: lb.period, place: w.place },
        });
        await tx.insert(leaderboardPayouts).values({
          periodId,
          place: w.place,
          userId: w.userId,
          amount: w.amount,
          ledgerEntryId: res.entryId,
        });
        paid.push({ userId: w.userId, place: w.place, amount: w.amount });
      }
      return true;
    });
    for (const p of paid) {
      await this.notifications.create({
        userId: p.userId,
        type: 'leaderboard_prize',
        params: { place: p.place, gems: p.amount, period: lb.period },
      });
    }
    return created;
  }
}
