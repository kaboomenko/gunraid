import { Inject, Injectable } from '@nestjs/common';
import {
  achievements,
  cases,
  games,
  items,
  leaderboards,
  levels,
  newId,
  partners,
  promoCodes,
  wheelPrizes,
  type Db,
} from '@gunraid/db';
import type {
  AdminAchievementBody,
  AdminAchievementDto,
  AdminLeaderboardBody,
  AdminLeaderboardDto,
  AdminLevelsBody,
  AdminPartnerBody,
  AdminPartnerDto,
  AdminPromoBody,
  AdminPromoDto,
  AdminWheelPrizeBody,
  AdminWheelPrizeDto,
} from '@gunraid/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { localize } from '../catalog/item-mapper.js';
import type { GameRow } from '../games/games.service.js';

/** Требуемые поля для типа приза колеса / промокода. */
function checkPrizeFields(
  type: string,
  b: {
    amount?: number | null;
    itemId?: string | null;
    caseId?: string | null;
    percent?: number | null;
  },
): void {
  const missing =
    (type === 'balance' && !b.amount) ||
    (type === 'item' && !b.itemId) ||
    (type === 'free_case' && !b.caseId) ||
    (type === 'deposit_bonus' && !b.percent);
  if (missing) throw new AppError('VALIDATION_ERROR', 400, { reason: 'type_fields', type });
}

/** Бонусы: колесо, промокоды и партнёры, уровни, лидерборды, достижения. Все правки — в аудит. */
@Injectable()
export class AdminBonusesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---------- Колесо ----------

  async wheelPrizes(game: GameRow): Promise<AdminWheelPrizeDto[]> {
    const rows = await this.db
      .select({
        p: wheelPrizes,
        itemName: items.fullName,
        caseName: cases.name,
      })
      .from(wheelPrizes)
      .leftJoin(items, eq(items.id, wheelPrizes.itemId))
      .leftJoin(cases, eq(cases.id, wheelPrizes.caseId))
      .where(eq(wheelPrizes.gameId, game.id))
      .orderBy(asc(wheelPrizes.sortOrder));
    return rows.map((r) => ({
      id: r.p.id,
      type: r.p.type,
      amount: r.p.amount,
      itemId: r.p.itemId,
      itemName: r.itemName ?? null,
      caseId: r.p.caseId,
      caseName: r.caseName ? localize(r.caseName) : null,
      percent: r.p.percent !== null ? Number(r.p.percent) : null,
      maxAmount: r.p.maxAmount,
      weight: r.p.weight,
      label: localize(r.p.label),
      color: r.p.color,
      sortOrder: r.p.sortOrder,
      isActive: r.p.isActive,
    }));
  }

  private prizeValues(b: AdminWheelPrizeBody) {
    checkPrizeFields(b.type, b);
    return {
      type: b.type,
      amount: b.type === 'balance' ? (b.amount ?? null) : null,
      itemId: b.type === 'item' ? (b.itemId ?? null) : null,
      caseId: b.type === 'free_case' ? (b.caseId ?? null) : null,
      percent: b.type === 'deposit_bonus' ? (b.percent ?? null) : null,
      maxAmount: b.type === 'deposit_bonus' ? (b.maxAmount ?? null) : null,
      weight: b.weight,
      label: { ru: b.label },
      color: b.color,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
    };
  }

  async saveWheelPrize(
    actorId: string,
    game: GameRow,
    id: string | null,
    b: AdminWheelPrizeBody,
    ip: string | null,
  ): Promise<string> {
    const values = this.prizeValues(b);
    return this.db.transaction(async (tx) => {
      const prizeId = id ?? newId();
      if (id) {
        const [row] = await tx
          .update(wheelPrizes)
          .set(values)
          .where(eq(wheelPrizes.id, id))
          .returning({ id: wheelPrizes.id });
        if (!row) throw notFound();
      } else {
        await tx.insert(wheelPrizes).values({ id: prizeId, gameId: game.id, ...values });
      }
      await this.audit.log(
        {
          actorId,
          action: id ? 'wheel_prize.update' : 'wheel_prize.create',
          entityType: 'wheel_prize',
          entityId: prizeId,
          after: b,
          ip,
        },
        tx,
      );
      return prizeId;
    });
  }

  // ---------- Промокоды и партнёры ----------

  async promos(): Promise<AdminPromoDto[]> {
    const rows = await this.db
      .select({ p: promoCodes, game: games.code, partnerName: partners.name })
      .from(promoCodes)
      .leftJoin(games, eq(games.id, promoCodes.gameId))
      .leftJoin(partners, eq(partners.id, promoCodes.partnerId))
      .orderBy(desc(promoCodes.createdAt));
    return rows.map((r) => ({
      id: r.p.id,
      code: r.p.code,
      type: r.p.type,
      amount: r.p.amount,
      percent: r.p.percent !== null ? Number(r.p.percent) : null,
      maxAmount: r.p.maxAmount,
      caseId: r.p.caseId,
      itemId: r.p.itemId,
      game: r.game ?? null,
      totalLimit: r.p.totalLimit,
      perUserLimit: r.p.perUserLimit,
      activationsCount: r.p.activationsCount,
      startsAt: r.p.startsAt?.toISOString() ?? null,
      expiresAt: r.p.expiresAt?.toISOString() ?? null,
      minDepositGems: r.p.minDepositGems,
      minDepositPeriodDays: r.p.minDepositPeriodDays,
      newUsersMaxAgeHours: r.p.newUsersMaxAgeHours,
      partnerId: r.p.partnerId,
      partnerName: r.partnerName ?? null,
      isActive: r.p.isActive,
      createdAt: r.p.createdAt.toISOString(),
    }));
  }

  async savePromo(
    actorId: string,
    id: string | null,
    b: AdminPromoBody,
    ip: string | null,
  ): Promise<string> {
    checkPrizeFields(b.type, b);
    let gameId: number | null = null;
    if (b.game) {
      const [g] = await this.db.select({ id: games.id }).from(games).where(eq(games.code, b.game));
      if (!g) throw new AppError('VALIDATION_ERROR', 400, { field: 'game' });
      gameId = g.id;
    }
    const values = {
      code: b.code.toUpperCase(),
      type: b.type,
      amount: b.type === 'balance' ? (b.amount ?? null) : null,
      percent: b.type === 'deposit_bonus' ? (b.percent ?? null) : null,
      maxAmount: b.type === 'deposit_bonus' ? (b.maxAmount ?? null) : null,
      caseId: b.type === 'free_case' ? (b.caseId ?? null) : null,
      itemId: b.type === 'item' ? (b.itemId ?? null) : null,
      gameId,
      totalLimit: b.totalLimit ?? null,
      perUserLimit: b.perUserLimit,
      startsAt: b.startsAt ? new Date(b.startsAt) : null,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      minDepositGems: b.minDepositGems ?? null,
      minDepositPeriodDays: b.minDepositPeriodDays ?? null,
      newUsersMaxAgeHours: b.newUsersMaxAgeHours ?? null,
      partnerId: b.partnerId ?? null,
      isActive: b.isActive,
    };
    try {
      return await this.db.transaction(async (tx) => {
        const promoId = id ?? newId();
        if (id) {
          const [row] = await tx
            .update(promoCodes)
            .set(values)
            .where(eq(promoCodes.id, id))
            .returning({ id: promoCodes.id });
          if (!row) throw notFound();
        } else {
          await tx.insert(promoCodes).values({ id: promoId, ...values, createdBy: actorId });
        }
        await this.audit.log(
          {
            actorId,
            action: id ? 'promo.update' : 'promo.create',
            entityType: 'promo_code',
            entityId: promoId,
            after: b,
            ip,
          },
          tx,
        );
        return promoId;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', 409, { field: 'code' });
      throw err;
    }
  }

  async partnersList(): Promise<AdminPartnerDto[]> {
    const res = await this.db.execute(sql`
      select p.id, p.name, p.contacts, p.note, p.created_at,
        (select count(*)::int from promo_codes pc where pc.partner_id = p.id) as promo_codes,
        (select count(*)::int from promo_activations pa join promo_codes pc on pc.id = pa.promo_id where pc.partner_id = p.id) as activations,
        (select count(distinct pa.user_id)::int from promo_activations pa join promo_codes pc on pc.id = pa.promo_id where pc.partner_id = p.id) as users,
        (select count(distinct d.user_id)::int from deposits d where d.status = 'succeeded' and d.user_id in
           (select pa.user_id from promo_activations pa join promo_codes pc on pc.id = pa.promo_id where pc.partner_id = p.id)) as depositors,
        (select coalesce(sum(d.gems_amount), 0)::bigint from deposits d where d.status = 'succeeded' and d.user_id in
           (select pa.user_id from promo_activations pa join promo_codes pc on pc.id = pa.promo_id where pc.partner_id = p.id)) as deposits_gems
      from partners p order by p.created_at desc
    `);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      contacts: (r.contacts as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      stats: {
        promoCodes: Number(r.promo_codes),
        activations: Number(r.activations),
        users: Number(r.users),
        depositors: Number(r.depositors),
        depositsGems: Number(r.deposits_gems),
      },
    }));
  }

  async savePartner(
    actorId: string,
    id: string | null,
    b: AdminPartnerBody,
    ip: string | null,
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      const partnerId = id ?? newId();
      const values = { name: b.name, contacts: b.contacts ?? null, note: b.note ?? null };
      if (id) {
        const [row] = await tx
          .update(partners)
          .set(values)
          .where(eq(partners.id, id))
          .returning({ id: partners.id });
        if (!row) throw notFound();
      } else {
        await tx.insert(partners).values({ id: partnerId, ...values });
      }
      await this.audit.log(
        {
          actorId,
          action: id ? 'partner.update' : 'partner.create',
          entityType: 'partner',
          entityId: partnerId,
          after: b,
          ip,
        },
        tx,
      );
      return partnerId;
    });
  }

  // ---------- Уровни ----------

  async saveLevels(actorId: string, b: AdminLevelsBody, ip: string | null): Promise<void> {
    const sorted = [...b.levels].sort((x, y) => x.level - y.level);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.xpRequired <= sorted[i - 1]!.xpRequired) {
        throw new AppError('VALIDATION_ERROR', 400, {
          reason: 'xp_order',
          level: sorted[i]!.level,
        });
      }
    }
    await this.db.transaction(async (tx) => {
      for (const l of sorted) {
        await tx
          .insert(levels)
          .values({ level: l.level, xpRequired: l.xpRequired, reward: l.reward })
          .onConflictDoUpdate({
            target: levels.level,
            set: { xpRequired: l.xpRequired, reward: l.reward },
          });
      }
      const keep = sorted.map((l) => l.level);
      await tx.delete(levels).where(
        sql`${levels.level} not in (${sql.join(
          keep.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      );
      await this.audit.log(
        {
          actorId,
          action: 'levels.update',
          entityType: 'levels',
          entityId: null,
          after: { count: sorted.length },
          ip,
        },
        tx,
      );
    });
  }

  // ---------- Лидерборды ----------

  async leaderboardsList(): Promise<AdminLeaderboardDto[]> {
    const rows = await this.db
      .select({ l: leaderboards, game: games.code })
      .from(leaderboards)
      .innerJoin(games, eq(games.id, leaderboards.gameId))
      .orderBy(asc(games.sortOrder), asc(leaderboards.period));
    return rows.map((r) => ({
      id: r.l.id,
      game: r.game,
      period: r.l.period,
      prizes: r.l.prizes,
      isActive: r.l.isActive,
    }));
  }

  async saveLeaderboard(
    actorId: string,
    id: string,
    b: AdminLeaderboardBody,
    ip: string | null,
  ): Promise<void> {
    for (const p of b.prizes) {
      if (p.to < p.from) throw new AppError('VALIDATION_ERROR', 400, { reason: 'range' });
    }
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(leaderboards)
        .set({ prizes: b.prizes, isActive: b.isActive })
        .where(eq(leaderboards.id, id))
        .returning({ id: leaderboards.id });
      if (!row) throw notFound();
      await this.audit.log(
        {
          actorId,
          action: 'leaderboard.update',
          entityType: 'leaderboard',
          entityId: id,
          after: b,
          ip,
        },
        tx,
      );
    });
  }

  // ---------- Достижения ----------

  async achievementsList(): Promise<AdminAchievementDto[]> {
    const rows = await this.db.select().from(achievements).orderBy(asc(achievements.sortOrder));
    return rows.map((a) => ({
      id: a.id,
      code: a.code,
      name: localize(a.name),
      description: localize(a.description),
      icon: a.icon,
      conditionType: a.condition.type,
      target: a.condition.target,
      sortOrder: a.sortOrder,
      isActive: a.isActive,
    }));
  }

  async saveAchievement(
    actorId: string,
    id: string,
    b: AdminAchievementBody,
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(achievements).where(eq(achievements.id, id)).for('update');
      if (!a) throw notFound();
      await tx
        .update(achievements)
        .set({
          ...(b.name !== undefined ? { name: { ...a.name, ru: b.name } } : {}),
          ...(b.description !== undefined
            ? { description: { ...a.description, ru: b.description } }
            : {}),
          ...(b.target !== undefined ? { condition: { ...a.condition, target: b.target } } : {}),
          ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        })
        .where(eq(achievements.id, id));
      await this.audit.log(
        {
          actorId,
          action: 'achievement.update',
          entityType: 'achievement',
          entityId: id,
          after: b,
          ip,
        },
        tx,
      );
    });
  }

  /** Поиск кейсов и предметов для форм (приз колеса, промокод). */
  async refs(game: GameRow, q: string) {
    const [caseRows, itemRows] = await Promise.all([
      this.db
        .select({ id: cases.id, name: cases.name, price: cases.price })
        .from(cases)
        .where(eq(cases.gameId, game.id))
        .orderBy(asc(cases.price)),
      this.db
        .select({ id: items.id, name: items.fullName, price: items.price })
        .from(items)
        .where(
          q
            ? sql`${items.gameId} = ${game.id} and ${items.fullName} ilike ${`%${q.replace(/[%_]/g, '\\$&')}%`}`
            : eq(items.gameId, game.id),
        )
        .orderBy(asc(items.price))
        .limit(50),
    ]);
    return {
      cases: caseRows.map((c) => ({ id: c.id, name: localize(c.name), price: c.price })),
      items: itemRows,
    };
  }
}
