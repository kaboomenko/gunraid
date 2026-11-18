import { Inject, Injectable } from '@nestjs/common';
import {
  levelRewardsGranted,
  levels,
  users,
  xpEvents,
  type Db,
  type DbOrTx,
  type LevelReward,
} from '@gunraid/db';
import type { LevelInfoDto, LevelRowDto } from '@gunraid/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EntitlementsService } from './entitlements.service.js';

const CACHE_MS = 30_000;

export interface XpResult {
  xp: number;
  level: number;
  levelsGained: number[];
}

/** Уровни и XP: XP начисляется за гемы, поставленные в режимах; за новый уровень — награда (один раз). */
@Injectable()
export class LevelsService {
  private cache: { rows: LevelRowDto[]; expires: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly entitlements: EntitlementsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async table(): Promise<LevelRowDto[]> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.rows;
    const rows = await this.db.select().from(levels).orderBy(asc(levels.level));
    const mapped = rows.map((r) => ({
      level: r.level,
      xpRequired: r.xpRequired,
      reward: r.reward,
    }));
    this.cache = { rows: mapped, expires: Date.now() + CACHE_MS };
    return mapped;
  }

  levelFor(table: LevelRowDto[], xp: number): number {
    let level = 1;
    for (const row of table) if (row.xpRequired <= xp) level = Math.max(level, row.level);
    return level;
  }

  /**
   * Начисление XP за ставку (идемпотентно по источнику). Порядок блокировок: кошелёк → пользователь.
   * Награды за каждый новый уровень выдаются ровно один раз (PK user+level).
   */
  async addForWager(
    userId: string,
    gems: number,
    sourceType: string,
    sourceId: string,
  ): Promise<XpResult | null> {
    const { xpPerGem } = await this.settings.get('xp');
    const amount = Math.floor(gems * xpPerGem);
    if (amount <= 0) return null;
    const table = await this.table();
    const result = await this.db.transaction(async (tx) => {
      await this.ledger.lockWallet(tx, userId);
      const inserted = await tx
        .insert(xpEvents)
        .values({ userId, amount, sourceType, sourceId })
        .onConflictDoNothing()
        .returning({ id: xpEvents.id });
      if (!inserted.length) return null;
      const [u] = await tx
        .update(users)
        .set({ xp: sql`${users.xp} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ xp: users.xp, level: users.level });
      if (!u) return null;
      const newLevel = this.levelFor(table, u.xp);
      const levelsGained: number[] = [];
      if (newLevel > u.level) {
        await tx
          .update(users)
          .set({ level: sql`greatest(${users.level}, ${newLevel})` })
          .where(eq(users.id, userId));
        for (let l = u.level + 1; l <= newLevel; l++) {
          const granted = await tx
            .insert(levelRewardsGranted)
            .values({ userId, level: l })
            .onConflictDoNothing()
            .returning({ level: levelRewardsGranted.level });
          if (!granted.length) continue;
          levelsGained.push(l);
          const reward = table.find((r) => r.level === l)?.reward;
          if (reward) await this.applyReward(tx, userId, l, reward);
        }
      }
      return { xp: u.xp, level: Math.max(u.level, newLevel), levelsGained };
    });
    if (result?.levelsGained.length) {
      const top = Math.max(...result.levelsGained);
      await this.notifications.create({
        userId,
        type: 'level_up',
        params: { level: top },
        link: null,
      });
    }
    return result;
  }

  private async applyReward(
    tx: DbOrTx,
    userId: string,
    level: number,
    reward: LevelReward,
  ): Promise<void> {
    if (reward.balance && reward.balance > 0) {
      await this.ledger.post(tx, {
        userId,
        type: 'level_reward',
        amount: reward.balance,
        refType: 'level',
        idempotencyKey: `level_reward:${userId}:${level}`,
        meta: { level },
      });
    }
    for (let i = 0; i < (reward.wheelSpins ?? 0); i++) {
      await this.entitlements.grant(tx, {
        userId,
        type: 'wheel_spin',
        sourceType: 'level',
        sourceId: String(level),
      });
    }
    if (reward.depositBonus) {
      await this.entitlements.grant(tx, {
        userId,
        type: 'deposit_bonus',
        percent: reward.depositBonus.percent,
        maxAmount: reward.depositBonus.maxAmount,
        sourceType: 'level',
        sourceId: String(level),
      });
    }
  }

  async info(userId: string): Promise<LevelInfoDto> {
    const [[u], table, { xpPerGem }] = await Promise.all([
      this.db.select({ xp: users.xp, level: users.level }).from(users).where(eq(users.id, userId)),
      this.table(),
      this.settings.get('xp'),
    ]);
    const level = u?.level ?? 1;
    const current = table.find((r) => r.level === level);
    const next = table.find((r) => r.level === level + 1);
    return {
      level,
      xp: u?.xp ?? 0,
      currentLevelXp: current?.xpRequired ?? 0,
      nextLevelXp: next?.xpRequired ?? null,
      nextReward: next?.reward ?? null,
      maxLevel: table.length ? table[table.length - 1]!.level : level,
      xpPerGem,
    };
  }
}
