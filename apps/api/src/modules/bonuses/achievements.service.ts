import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  achievements,
  battleParticipants,
  battles,
  caseOpenings,
  contracts,
  dailyBonusClaims,
  deposits,
  referralRewards,
  upgrades,
  userAchievements,
  userItems,
  users,
  type AchievementCondition,
  type Db,
} from '@gunraid/db';
import type { AchievementDto } from '@gunraid/shared';
import { and, asc, count, countDistinct, eq, lt, ne, notInArray, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { localize } from '../catalog/item-mapper.js';
import { NotificationsService } from '../notifications/notifications.service.js';

type Metric = AchievementCondition['type'];

/**
 * Достижения: условия из фиксированного набора типов (параметры — в БД).
 * Прогресс пересчитывается в воркере по событиям пользователя (с дебаунсом).
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  /** Отложенная проверка (пачка событий одного пользователя → одна проверка). */
  schedule(userId: string, delayMs = 1000): void {
    if (this.pending.has(userId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(userId);
      this.evaluate(userId).catch((err: unknown) =>
        this.logger.warn(`achievements for ${userId}: ${(err as Error).message}`),
      );
    }, delayMs);
    timer.unref?.();
    this.pending.set(userId, timer);
  }

  private async metric(userId: string, c: AchievementCondition): Promise<number> {
    const one = async (q: Promise<Array<{ v: number | string | null }>>) =>
      Number((await q)[0]?.v ?? 0);
    switch (c.type as Metric) {
      case 'cases_opened':
        return one(
          this.db.select({ v: count() }).from(caseOpenings).where(eq(caseOpenings.userId, userId)),
        );
      case 'upgrades_won':
        return one(
          this.db
            .select({ v: count() })
            .from(upgrades)
            .where(and(eq(upgrades.userId, userId), eq(upgrades.isWin, true))),
        );
      case 'upgrade_win_below':
        return one(
          this.db
            .select({ v: count() })
            .from(upgrades)
            .where(
              and(
                eq(upgrades.userId, userId),
                eq(upgrades.isWin, true),
                lt(upgrades.chance, Math.round((c.maxChance ?? 0.1) * 1_000_000)),
              ),
            ),
        );
      case 'contracts_done':
        return one(
          this.db.select({ v: count() }).from(contracts).where(eq(contracts.userId, userId)),
        );
      case 'battles_won':
        return one(
          this.db
            .select({ v: count() })
            .from(battleParticipants)
            .innerJoin(battles, eq(battles.id, battleParticipants.battleId))
            .where(
              and(
                eq(battleParticipants.userId, userId),
                eq(battleParticipants.isWinner, true),
                eq(battles.status, 'finished'),
              ),
            ),
        );
      case 'best_drop':
        return one(
          this.db
            .select({ v: sql<number>`coalesce(max(${userItems.acquiredValue}), 0)::bigint` })
            .from(userItems)
            .where(
              and(
                eq(userItems.userId, userId),
                ne(userItems.status, 'lost_battle'),
                notInArray(userItems.sourceType, ['seed', 'admin']),
              ),
            ),
        );
      case 'level':
        return one(this.db.select({ v: users.level }).from(users).where(eq(users.id, userId)));
      case 'daily_streak':
        return one(
          this.db
            .select({ v: sql<number>`coalesce(max(${dailyBonusClaims.streak}), 0)::int` })
            .from(dailyBonusClaims)
            .where(eq(dailyBonusClaims.userId, userId)),
        );
      case 'deposits':
        return one(
          this.db
            .select({ v: count() })
            .from(deposits)
            .where(and(eq(deposits.userId, userId), eq(deposits.status, 'succeeded'))),
        );
      case 'referrals':
        return one(
          this.db
            .select({ v: countDistinct(referralRewards.referralId) })
            .from(referralRewards)
            .where(eq(referralRewards.referrerId, userId)),
        );
      default:
        return 0;
    }
  }

  /** Пересчёт прогресса; новые достижения — с уведомлением. Возвращает коды открытых сейчас. */
  async evaluate(userId: string): Promise<string[]> {
    const list = await this.db
      .select()
      .from(achievements)
      .where(eq(achievements.isActive, true))
      .orderBy(asc(achievements.sortOrder));
    const existing = await this.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    const byId = new Map(existing.map((e) => [e.achievementId, e]));
    const cache = new Map<string, number>();
    const unlocked: string[] = [];
    for (const a of list) {
      const prev = byId.get(a.id);
      if (prev?.unlockedAt) continue;
      const key = `${a.condition.type}:${a.condition.maxChance ?? ''}`;
      const value = cache.get(key) ?? (await this.metric(userId, a.condition));
      cache.set(key, value);
      const progress = Math.min(value, a.condition.target);
      const done = value >= a.condition.target;
      if (prev && prev.progress === progress && !done) continue;
      const rows = await this.db
        .insert(userAchievements)
        .values({
          userId,
          achievementId: a.id,
          progress,
          unlockedAt: done ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.achievementId],
          set: {
            progress,
            unlockedAt: done ? sql`coalesce(${userAchievements.unlockedAt}, now())` : null,
          },
          where: sql`${userAchievements.unlockedAt} IS NULL`,
        })
        .returning({ unlockedAt: userAchievements.unlockedAt });
      if (done && rows.length) {
        unlocked.push(a.code);
        await this.notifications.create({
          userId,
          type: 'achievement',
          params: { name: localize(a.name), code: a.code },
        });
      }
    }
    return unlocked;
  }

  async list(userId: string, onlyUnlocked = false): Promise<AchievementDto[]> {
    const rows = await this.db
      .select({ a: achievements, ua: userAchievements })
      .from(achievements)
      .leftJoin(
        userAchievements,
        and(
          eq(userAchievements.achievementId, achievements.id),
          eq(userAchievements.userId, userId),
        ),
      )
      .where(eq(achievements.isActive, true))
      .orderBy(asc(achievements.sortOrder));
    return rows
      .filter((r) => !onlyUnlocked || r.ua?.unlockedAt)
      .map((r) => ({
        code: r.a.code,
        name: localize(r.a.name),
        description: localize(r.a.description),
        icon: r.a.icon,
        target: r.a.condition.target,
        progress: r.ua?.progress ?? 0,
        unlockedAt: r.ua?.unlockedAt?.toISOString() ?? null,
      }));
  }
}
