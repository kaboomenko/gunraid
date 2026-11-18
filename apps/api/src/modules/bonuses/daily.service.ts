import { Inject, Injectable } from '@nestjs/common';
import { dailyBonusClaims, deposits, newId, type Db, type DbOrTx } from '@gunraid/db';
import type { DailyClaimResultDto, DailyStateDto } from '@gunraid/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

const DAY = 24 * 60 * 60 * 1000;

/** «День сайта» в часовом поясе из настроек: дата YYYY-MM-DD и начало следующего дня. */
export function siteDay(now: number, offsetMinutes: number): { day: string; nextAt: Date } {
  const shifted = now + offsetMinutes * 60_000;
  const dayIndex = Math.floor(shifted / DAY);
  return {
    day: new Date(dayIndex * DAY).toISOString().slice(0, 10),
    nextAt: new Date((dayIndex + 1) * DAY - offsetMinutes * 60_000),
  };
}

/** Ежедневный бонус со стриком: награда растёт по дням подряд, пропуск дня обнуляет стрик. */
@Injectable()
export class DailyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  private reward(rewards: number[], streak: number): number {
    return rewards[Math.min(streak, rewards.length) - 1] ?? rewards[rewards.length - 1] ?? 0;
  }

  private async hasDepositWithin(userId: string, days: number, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: deposits.id })
      .from(deposits)
      .where(
        and(
          eq(deposits.userId, userId),
          eq(deposits.status, 'succeeded'),
          gte(deposits.completedAt, new Date(Date.now() - days * DAY)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async state(userId: string, tx: DbOrTx = this.db): Promise<DailyStateDto> {
    const [s, site] = await Promise.all([this.settings.get('daily'), this.settings.get('site')]);
    const now = Date.now();
    const today = siteDay(now, site.dayUtcOffsetMinutes);
    const yesterday = siteDay(now - DAY, site.dayUtcOffsetMinutes);
    const rows = await tx
      .select()
      .from(dailyBonusClaims)
      .where(
        and(
          eq(dailyBonusClaims.userId, userId),
          inArray(dailyBonusClaims.day, [today.day, yesterday.day]),
        ),
      );
    const todayRow = rows.find((r) => r.day === today.day);
    const yRow = rows.find((r) => r.day === yesterday.day);
    const streak = todayRow ? todayRow.streak : yRow ? yRow.streak + 1 : 1;
    const blocked =
      s.requireDepositWithinDays &&
      !(await this.hasDepositWithin(userId, s.requireDepositWithinDays, tx))
        ? ('NO_DEPOSIT' as const)
        : null;
    return {
      canClaim: !todayRow && !blocked,
      claimedToday: Boolean(todayRow),
      streak,
      todayReward: todayRow ? todayRow.amount : this.reward(s.rewards, streak),
      rewards: s.rewards,
      nextAt: (todayRow ? today.nextAt : new Date(now)).toISOString(),
      blocked,
      requireDepositWithinDays: s.requireDepositWithinDays,
    };
  }

  async claim(tx: DbOrTx, userId: string): Promise<DailyClaimResultDto> {
    await this.ledger.lockWallet(tx, userId);
    const st = await this.state(userId, tx);
    if (st.claimedToday) throw new AppError('DAILY_ALREADY_CLAIMED', 409, { nextAt: st.nextAt });
    if (st.blocked) throw new AppError('DAILY_CONDITIONS_NOT_MET', 403, { reason: st.blocked });
    const site = await this.settings.get('site');
    const today = siteDay(Date.now(), site.dayUtcOffsetMinutes);
    const id = newId();
    const inserted = await tx
      .insert(dailyBonusClaims)
      .values({ id, userId, day: today.day, streak: st.streak, amount: st.todayReward })
      .onConflictDoNothing()
      .returning({ id: dailyBonusClaims.id });
    if (!inserted.length) throw new AppError('DAILY_ALREADY_CLAIMED', 409);
    const res = await this.ledger.post(tx, {
      userId,
      type: 'daily_bonus',
      amount: st.todayReward,
      refType: 'daily_bonus',
      refId: id,
      idempotencyKey: `daily:${userId}:${today.day}`,
      meta: { streak: st.streak },
    });
    await tx
      .update(dailyBonusClaims)
      .set({ ledgerEntryId: res.entryId })
      .where(eq(dailyBonusClaims.id, id));
    await this.outbox.add(tx, 'daily.claimed', { userId, streak: st.streak });
    return {
      amount: st.todayReward,
      streak: st.streak,
      balance: res.balanceAfter,
      nextAt: today.nextAt.toISOString(),
    };
  }

  /** Максимальный стрик (для ачивок). */
  async maxStreak(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ v: sql<number>`coalesce(max(${dailyBonusClaims.streak}), 0)::int` })
      .from(dailyBonusClaims)
      .where(eq(dailyBonusClaims.userId, userId));
    return row?.v ?? 0;
  }
}
