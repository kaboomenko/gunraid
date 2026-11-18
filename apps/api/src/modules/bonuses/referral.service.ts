import { Inject, Injectable } from '@nestjs/common';
import { newId, referralRewards, users, type Db } from '@gunraid/db';
import type { ReferralInfoDto } from '@gunraid/shared';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Реферальная программа: процент от пополнений приглашённых (настройка referral.percent). */
@Injectable()
export class ReferralService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Обработчик успешного пополнения (воркер). Идемпотентно по пополнению. */
  async onDeposit(depositId: string, userId: string, gems: number): Promise<number> {
    const [u] = await this.db
      .select({ referrer: users.referredById, nickname: users.nickname })
      .from(users)
      .where(eq(users.id, userId));
    if (!u?.referrer) return 0;
    const { percent } = await this.settings.get('referral');
    const amount = Math.floor(gems * percent);
    if (amount <= 0) return 0;
    const referrerId = u.referrer;
    const paid = await this.db.transaction(async (tx) => {
      await this.ledger.lockWallet(tx, referrerId);
      const id = newId();
      const inserted = await tx
        .insert(referralRewards)
        .values({
          id,
          referrerId,
          referralId: userId,
          depositId,
          depositGems: gems,
          percent,
          amount,
        })
        .onConflictDoNothing()
        .returning({ id: referralRewards.id });
      if (!inserted.length) return 0;
      const res = await this.ledger.post(tx, {
        userId: referrerId,
        type: 'referral_reward',
        amount,
        refType: 'referral_reward',
        refId: id,
        idempotencyKey: `referral:${depositId}`,
        meta: { referralId: userId },
      });
      await tx
        .update(referralRewards)
        .set({ ledgerEntryId: res.entryId })
        .where(eq(referralRewards.id, id));
      return amount;
    });
    if (paid > 0) {
      await this.notifications.create({
        userId: referrerId,
        type: 'referral_reward',
        params: { gems: paid, nickname: u.nickname },
      });
    }
    return paid;
  }

  async info(userId: string): Promise<ReferralInfoDto> {
    const [[me], [invited], [depositors], [earned], recent, { percent }] = await Promise.all([
      this.db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)),
      this.db.select({ n: count() }).from(users).where(eq(users.referredById, userId)),
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.referredById, userId), isNotNull(users.firstDepositAt))),
      this.db
        .select({ sum: sql<number>`coalesce(sum(${referralRewards.amount}), 0)::bigint` })
        .from(referralRewards)
        .where(eq(referralRewards.referrerId, userId)),
      this.db
        .select({
          nickname: users.nickname,
          amount: referralRewards.amount,
          createdAt: referralRewards.createdAt,
        })
        .from(referralRewards)
        .innerJoin(users, eq(users.id, referralRewards.referralId))
        .where(eq(referralRewards.referrerId, userId))
        .orderBy(desc(referralRewards.createdAt))
        .limit(10),
      this.settings.get('referral'),
    ]);
    return {
      code: me?.code ?? '',
      percent,
      invited: invited?.n ?? 0,
      depositors: depositors?.n ?? 0,
      earned: Number(earned?.sum ?? 0),
      recent: recent.map((r) => ({
        nickname: r.nickname,
        amount: r.amount,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
