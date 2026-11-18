import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import {
  NotificationsService,
  type NotificationInput,
} from '../notifications/notifications.service.js';
import { AchievementsService } from './achievements.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LevelsService } from './levels.service.js';
import { ReferralService } from './referral.service.js';

interface WagerPayload {
  userId: string;
  amount: number;
  sourceType: string;
  sourceId: string;
}

interface BattleFinishedPayload {
  battleId: string;
  game: string;
  participants: Array<{ userId: string; paid: number; isWinner: boolean; payout: number }>;
}

const LEADERBOARD_TICK_MS = 60_000;

/** Воркер: XP и уровни, рефералы, уведомления, ачивки, итоги лидербордов. */
@Injectable()
export class BonusesHandlers implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BonusesHandlers.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outbox: OutboxProcessor,
    private readonly levels: LevelsService,
    private readonly referral: ReferralService,
    private readonly achievements: AchievementsService,
    private readonly notifications: NotificationsService,
    private readonly leaderboards: LeaderboardService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('wager.placed', async (p) => {
      const w = p as unknown as WagerPayload;
      await this.levels.addForWager(w.userId, w.amount, w.sourceType, w.sourceId);
      this.achievements.schedule(w.userId);
    });
    this.outbox.on('deposit.succeeded', async (p) => {
      const d = p as { depositId: string; userId: string; gems: number; bonus: number };
      await this.referral.onDeposit(d.depositId, d.userId, d.gems);
      await this.notifications.create({
        userId: d.userId,
        type: 'deposit_succeeded',
        params: { gems: d.gems + (d.bonus ?? 0) },
      });
      this.achievements.schedule(d.userId);
    });
    this.outbox.on('battle.finished', async (p) => {
      const b = p as unknown as BattleFinishedPayload;
      for (const part of b.participants) {
        if (part.paid > 0) {
          await this.levels.addForWager(part.userId, part.paid, 'battle', b.battleId);
        }
        await this.notifications.create({
          userId: part.userId,
          type: part.isWinner ? 'battle_won' : 'battle_lost',
          params: part.isWinner ? { gems: part.payout } : {},
          link: b.game ? `/${b.game}/battles/${b.battleId}` : null,
        });
        this.achievements.schedule(part.userId);
      }
    });
    this.outbox.on('notification.create', async (p) => {
      await this.notifications.create(p as unknown as NotificationInput);
    });
    for (const type of ['daily.claimed', 'case.opened', 'drop.created'] as const) {
      this.outbox.on(type, async (p) => {
        const userId = (p as { userId?: string }).userId;
        if (userId) this.achievements.schedule(userId);
      });
    }
    const tick = () =>
      void this.leaderboards
        .finalizeDue()
        .catch((err: unknown) => this.logger.error(`leaderboards: ${(err as Error).message}`));
    setTimeout(tick, 5_000).unref?.();
    this.timer = setInterval(tick, LEADERBOARD_TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
