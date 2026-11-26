import { Inject, Injectable } from '@nestjs/common';
import { type Db } from '@gunraid/db';
import type { AdminDashboardDto, AdminModeStatsDto } from '@gunraid/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { rkey } from '../../core/redis.js';
import { DB, ENV, REDIS } from '../../core/tokens.js';
import { GamesService } from '../games/games.service.js';

const BONUS_TYPES = sql`('deposit_bonus','wheel_prize','promo_balance','daily_bonus','level_reward','referral_reward','leaderboard_prize')`;

function num(v: unknown): number {
  return Number(v ?? 0);
}

/** Дашборд: пользователи, пополнения, выводы, бонусы, GGR и фактический RTP по режимам против целевого. */
@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly games: GamesService,
  ) {}

  private async one(q: SQL): Promise<Record<string, unknown>> {
    const res = await this.db.execute(q);
    return (res.rows[0] as Record<string, unknown> | undefined) ?? {};
  }

  async get(days: number, gameCode: string | undefined): Promise<AdminDashboardDto> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const game = gameCode ? await this.games.getActive(gameCode) : null;
    const gf = (col: string) => (game ? sql.raw(`and ${col} = ${Number(game.id)}`) : sql``);

    const [usersRow, depRow, wdRow, bonusRow, cases, upgrades, contracts, battles, cargo, recon] =
      await Promise.all([
        this.one(sql`
          select count(*)::int as total,
                 count(*) filter (where created_at >= ${from})::int as new,
                 count(*) filter (where last_seen_at >= ${from})::int as active
          from users`),
        this.one(sql`
          select count(*)::int as count, coalesce(sum(gems_amount), 0)::bigint as gems,
                 count(distinct user_id)::int as users
          from deposits where status = 'succeeded' and completed_at >= ${from}`),
        this.one(sql`
          select count(*) filter (where status in ('pending_review','listing_submitted'))::int as pending,
                 count(*) filter (where status = 'completed' and updated_at >= ${from})::int as completed,
                 coalesce(sum(value) filter (where status = 'completed' and updated_at >= ${from}), 0)::bigint as completed_value
          from withdrawals where true ${gf('game_id')}`),
        this.one(sql`
          select coalesce(sum(amount), 0)::bigint as total from ledger_entries
          where type in ${BONUS_TYPES} and created_at >= ${from}`),
        this.one(sql`
          select count(*)::int as count, coalesce(sum(o.price_paid), 0)::bigint as wagered,
                 coalesce(sum(o.item_value) filter (where o.price_paid > 0), 0)::bigint as paid,
                 coalesce(sum(o.item_value) filter (where o.price_paid = 0), 0)::bigint as free_paid,
                 sum(o.price_paid * r.rtp) / nullif(sum(o.price_paid) filter (where r.rtp is not null), 0) as target
          from case_openings o join case_revisions r on r.id = o.revision_id
          where o.created_at >= ${from} ${gf('o.game_id')}`),
        this.one(sql`
          select count(*)::int as count, coalesce(sum(stake_value), 0)::bigint as wagered,
                 coalesce(sum(target_price) filter (where is_win), 0)::bigint as paid,
                 1 - avg(commission) as target
          from upgrades where created_at >= ${from} ${gf('game_id')}`),
        this.one(sql`
          select count(*)::int as count, coalesce(sum(input_value), 0)::bigint as wagered,
                 coalesce(sum(result_value), 0)::bigint as paid,
                 1 - avg(commission) as target
          from contracts where created_at >= ${from} ${gf('game_id')}`),
        this.one(sql`
          select count(distinct b.id)::int as count, coalesce(sum(p.paid_amount), 0)::bigint as wagered,
                 coalesce(sum(p.payout_value), 0)::bigint as paid
          from battles b join battle_participants p on p.battle_id = b.id and p.user_id is not null
          where b.status = 'finished' and b.finished_at >= ${from} ${gf('b.game_id')}`),
        // Грузы (D13): только приземлившиеся раунды — у отменённых и закрытых по минимуму гемы вернулись. Ставки —
        // оплата мест, выплаты — призы платных раундов; призы бесплатных — отдельно, как бесплатные кейсы.
        this.one(sql`
          select count(*)::int as count, coalesce(sum(p.paid), 0)::bigint as wagered,
                 coalesce(sum(ui.acquired_value) filter (where r.seat_price > 0), 0)::bigint as paid,
                 coalesce(sum(ui.acquired_value) filter (where r.seat_price = 0), 0)::bigint as free_paid
          from cargo_rounds r
          left join lateral (
            select sum(cp.paid) as paid from cargo_purchases cp where cp.round_id = r.id
          ) p on true
          left join user_items ui on ui.id = r.user_item_id
          where r.status = 'landed' and r.finished_at >= ${from} ${gf('r.game_id')}`),
        this.redis.get(rkey(this.env, 'recon', 'last')),
      ]);

    const mode = (
      m: AdminModeStatsDto['mode'],
      row: Record<string, unknown>,
      target: number | null,
    ): AdminModeStatsDto => {
      const wagered = num(row.wagered);
      const paid = num(row.paid);
      return {
        mode: m,
        count: num(row.count),
        wagered,
        paid,
        ggr: wagered - paid,
        rtp: wagered > 0 ? paid / wagered : null,
        targetRtp: target,
      };
    };
    const modes = [
      mode(
        'cases',
        cases,
        cases.target !== null && cases.target !== undefined ? num(cases.target) : null,
      ),
      mode(
        'upgrade',
        upgrades,
        upgrades.target !== null && upgrades.target !== undefined ? num(upgrades.target) : null,
      ),
      mode(
        'contract',
        contracts,
        contracts.target !== null && contracts.target !== undefined ? num(contracts.target) : null,
      ),
      mode('battles', battles, null),
      // Целевого RTP нет: фактический зависит от того, сколько мест продано к приземлению.
      mode('cargo', cargo, null),
    ];
    let reconciliation: AdminDashboardDto['reconciliation'] = { checkedAt: null, mismatches: null };
    if (recon) {
      try {
        const parsed = JSON.parse(recon) as { checkedAt: string; mismatches: unknown[] };
        reconciliation = { checkedAt: parsed.checkedAt, mismatches: parsed.mismatches.length };
      } catch {
        // повреждённое значение — покажем «не проверялось»
      }
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      game: game?.code ?? null,
      users: { total: num(usersRow.total), new: num(usersRow.new), active: num(usersRow.active) },
      deposits: { count: num(depRow.count), gems: num(depRow.gems), users: num(depRow.users) },
      withdrawals: {
        pending: num(wdRow.pending),
        completedCount: num(wdRow.completed),
        completedValue: num(wdRow.completed_value),
      },
      bonuses: num(bonusRow.total),
      // Призы бесплатных кейсов и бесплатных грузов — расход без ставок.
      ggr: modes.reduce((a, m) => a + m.ggr, 0) - num(cases.free_paid) - num(cargo.free_paid),
      modes,
      reconciliation,
    };
  }
}
