import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  cases,
  dailyBonusClaims,
  games,
  items,
  leaderboards,
  newId,
  promoCodes,
  userEntitlements,
  userItems,
  users,
} from '@gunraid/db';
import { pickWeighted, rollFloat } from '@gunraid/game-core';
import type {
  AchievementDto,
  CaseDetailDto,
  CaseOpenResultDto,
  DailyStateDto,
  DepositDto,
  DepositQuoteDto,
  LeaderboardsDto,
  NotificationsDto,
  PromoActivateResultDto,
  WheelProofDto,
  WheelSpinResultDto,
  WheelStateDto,
} from '@gunraid/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestClient } from '../../test/app.js';
import { db, gameId, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { EntitlementsService } from './entitlements.service.js';
import { AchievementsService } from './achievements.service.js';
import { siteDay } from './daily.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LevelsService } from './levels.service.js';
import { ReferralService } from './referral.service.js';

let app: NestFastifyApplication;
type Err = { error: { code: string; details?: { reason?: string } } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

/** Тестовое пополнение через тестового провайдера (как в интерфейсе). */
async function deposit(client: TestClient, usd: number): Promise<DepositDto> {
  const q = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
    method: 'card',
    currency: 'USD',
    amount: String(usd),
  });
  const d = await client.post<DepositDto>('/api/v1/deposits', { quoteId: q.body.quoteId }, IK());
  const done = await client.post<DepositDto>(`/api/v1/payments/mock/${d.body.id}/complete`, {
    result: 'success',
  });
  expect(done.status).toBe(200);
  return done.body;
}

async function makeOld(userId: string) {
  await db(app)
    .update(users)
    .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
    .where(eq(users.id, userId));
}

async function insertPromo(
  values: Partial<typeof promoCodes.$inferInsert> & {
    type: 'balance' | 'deposit_bonus' | 'free_case' | 'wheel_spin' | 'item';
  },
) {
  const code = `T${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
  await db(app)
    .insert(promoCodes)
    .values({ id: newId(), code, perUserLimit: 1, ...values });
  return code;
}

describe('daily bonus (integration)', () => {
  it('can be claimed once per day even with parallel requests', async () => {
    const { client, me } = await newPlayer(app, 'dly');
    const st = (await client.get<DailyStateDto>('/api/v1/bonuses/daily')).body;
    expect(st.canClaim).toBe(true);
    expect(st.streak).toBe(1);
    const res = await Promise.all(
      [1, 2, 3].map(() => client.post('/api/v1/bonuses/daily/claim', {}, IK())),
    );
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await userBalance(app, me.id)).toBe(st.rewards[0]);
    const after = (await client.get<DailyStateDto>('/api/v1/bonuses/daily')).body;
    expect(after.claimedToday).toBe(true);
    expect(after.canClaim).toBe(false);
  });

  it('continues the streak after yesterday', async () => {
    const { client, me } = await newPlayer(app, 'dly2');
    const yesterday = siteDay(Date.now() - 86_400_000, 180).day;
    await db(app)
      .insert(dailyBonusClaims)
      .values({ id: newId(), userId: me.id, day: yesterday, streak: 1, amount: 5 });
    const st = (await client.get<DailyStateDto>('/api/v1/bonuses/daily')).body;
    expect(st.streak).toBe(2);
    const claim = await client.post<{ amount: number; streak: number }>(
      '/api/v1/bonuses/daily/claim',
      {},
      IK(),
    );
    expect(claim.body.streak).toBe(2);
    expect(claim.body.amount).toBe(st.rewards[1]);
  });
});

describe('wheel of fortune (integration)', () => {
  it('checks conditions, spins once per cooldown, extra spins work and results are verifiable', async () => {
    const { client, me } = await newPlayer(app, 'whl');
    let st = (await client.get<WheelStateDto>('/api/v1/games/cs2/wheel')).body;
    expect(st.prizes.length).toBeGreaterThan(3);
    expect(st.reason).toBe('ACCOUNT_AGE');
    await makeOld(me.id);
    st = (await client.get<WheelStateDto>('/api/v1/games/cs2/wheel')).body;
    expect(st.reason).toBe('NO_DEPOSIT');
    const blocked = await client.post<Err>('/api/v1/games/cs2/wheel/spin', {}, IK());
    expect(blocked.status).toBe(403);
    await deposit(client, 5);
    st = (await client.get<WheelStateDto>('/api/v1/games/cs2/wheel')).body;
    expect(st.canSpin).toBe(true);

    const spins = await Promise.all(
      [1, 2, 3, 4].map(() =>
        client.post<WheelSpinResultDto>('/api/v1/games/cs2/wheel/spin', {}, IK()),
      ),
    );
    const ok = spins.filter((r) => r.status === 200);
    // Бесплатное вращение — ровно одно. Если оно (или следующее) выиграло «доп. вращение»,
    // параллельный запрос законно тратит это право — поэтому успешных может быть больше.
    expect(ok.filter((r) => !r.body.isExtra)).toHaveLength(1);
    const wonExtra = ok.filter((r) => r.body.prize.type === 'extra_spin').length;
    expect(ok).toHaveLength(Math.min(spins.length, 1 + wonExtra));
    for (const r of spins.filter((x) => x.status !== 200)) {
      expect((r.body as unknown as Err).error.code).toBe('WHEEL_COOLDOWN');
    }
    const first = ok.find((r) => !r.body.isExtra)!.body;
    expect(first.isExtra).toBe(false);
    expect(first.nextAt).not.toBeNull();

    // Доп. вращение по бонусу
    await db(app).transaction((tx) =>
      app
        .get(EntitlementsService)
        .grant(tx, { userId: me.id, type: 'wheel_spin', sourceType: 'admin' }),
    );
    const extra = await client.post<WheelSpinResultDto>('/api/v1/games/cs2/wheel/spin', {}, IK());
    expect(extra.status).toBe(200);
    expect(extra.body.isExtra).toBe(true);
    // Если в одном из вращений выпал приз «доп. вращение», право появилось снова —
    // тогда следующее вращение законно; иначе — кулдаун.
    const none = await client.post<Err>('/api/v1/games/cs2/wheel/spin', {}, IK());
    if (extra.body.extraSpins > 0) {
      expect(none.status).toBe(200);
    } else {
      expect(none.status).toBe(409);
      expect(none.body.error.code).toBe('WHEEL_COOLDOWN');
    }

    // Provably fair
    await client.post('/api/v1/fair/rotate');
    const proof = (await client.get<WheelProofDto>(`/api/v1/fair/proof/wheel_spin/${first.id}`))
      .body;
    expect(proof.revealed).toBe(true);
    const roll = rollFloat(proof.serverSeed!, proof.clientSeed, proof.nonce);
    const pick = pickWeighted(
      proof.prizes.map((p) => p.weight),
      roll,
    );
    expect(pick.index).toBe(first.prizeIndex);
    expect(pick.ticket).toBe(proof.ticket);
  });
});

describe('promo codes (integration)', () => {
  it('never exceeds the total activation limit', async () => {
    const code = await insertPromo({ type: 'balance', amount: 30, totalLimit: 1 });
    const players = await Promise.all([1, 2, 3, 4].map((i) => newPlayer(app, `pr${i}`)));
    const res = await Promise.all(
      players.map((p) => p.client.post<PromoActivateResultDto>('/api/v1/promo/activate', { code })),
    );
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 200)) {
      expect((r.body as unknown as Err).error.code).toBe('PROMO_LIMIT_REACHED');
    }
    const [row] = await db(app).select().from(promoCodes).where(eq(promoCodes.code, code));
    expect(row?.activationsCount).toBe(1);
  });

  it('enforces per-user limit, expiry, game binding and deposit conditions', async () => {
    const { client, me } = await newPlayer(app, 'prc');
    const code = await insertPromo({ type: 'balance', amount: 25 });
    const a = await client.post<PromoActivateResultDto>('/api/v1/promo/activate', {
      code: code.toLowerCase(),
    });
    expect(a.status).toBe(200);
    expect(a.body.balance).toBe(25);
    expect(await userBalance(app, me.id)).toBe(25);
    const again = await client.post<Err>('/api/v1/promo/activate', { code });
    expect(again.body.error.code).toBe('PROMO_ALREADY_USED');

    const expired = await insertPromo({
      type: 'balance',
      amount: 10,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await client.post<Err>('/api/v1/promo/activate', { code: expired })).body.error.code,
    ).toBe('PROMO_EXPIRED');
    const cs2 = await gameId(app, 'cs2');
    const bound = await insertPromo({ type: 'wheel_spin', gameId: cs2 });
    expect(
      (await client.post<Err>('/api/v1/promo/activate', { code: bound, game: 'standoff2' })).body
        .error.code,
    ).toBe('PROMO_WRONG_GAME');
    const rich = await insertPromo({ type: 'balance', amount: 10, minDepositGems: 500 });
    const r = await client.post<Err>('/api/v1/promo/activate', { code: rich });
    expect(r.body.error.code).toBe('PROMO_CONDITIONS_NOT_MET');
    expect(await userBalance(app, me.id)).toBe(25);
  });

  it('a deposit bonus promo is applied to the next deposit exactly once', async () => {
    const { client, me } = await newPlayer(app, 'prd');
    // Первое пополнение — без бонуса за первый депозит не обойтись, поэтому сначала «сжигаем» его.
    await deposit(client, 1);
    const code = await insertPromo({ type: 'deposit_bonus', percent: 0.2, maxAmount: 150 });
    const act = await client.post<PromoActivateResultDto>('/api/v1/promo/activate', { code });
    expect(act.status).toBe(200);
    const q = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: '10',
    });
    expect(q.body.gems).toBe(1000);
    expect(q.body.entitlementBonusGems).toBe(150);
    const before = await userBalance(app, me.id);
    await deposit(client, 10);
    expect(await userBalance(app, me.id)).toBe(before + 1000 + 150);
    const q2 = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
      method: 'card',
      currency: 'USD',
      amount: '10',
    });
    expect(q2.body.entitlementBonusGems).toBe(0);
  });
});

describe('free case from a bonus (integration)', () => {
  it('opens without charging and only once for one entitlement', async () => {
    const { client, me } = await newPlayer(app, 'frc');
    const [c] = await db(app)
      .select({ id: cases.id, slug: cases.slug })
      .from(cases)
      .innerJoin(games, eq(games.id, cases.gameId))
      .where(and(eq(games.code, 'cs2'), eq(cases.kind, 'paid')))
      .orderBy(asc(cases.price))
      .limit(1);
    await db(app).transaction((tx) =>
      app.get(EntitlementsService).grant(tx, {
        userId: me.id,
        type: 'free_case',
        caseId: c!.id,
        sourceType: 'admin',
      }),
    );
    const detail = await client.get<CaseDetailDto>(`/api/v1/games/cs2/cases/${c!.slug}`);
    expect(detail.body.availability.freeOpens).toBe(1);
    const res = await Promise.all(
      [1, 2, 3].map(() =>
        client.post<CaseOpenResultDto>(
          `/api/v1/games/cs2/cases/${c!.slug}/open`,
          { count: 1, useBonus: true },
          IK(),
        ),
      ),
    );
    const ok = res.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.body.freeOpens).toBe(0);
    expect(await userBalance(app, me.id)).toBe(0);
    const [ent] = await db(app)
      .select({ status: userEntitlements.status })
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, me.id));
    expect(ent?.status).toBe('used');
  });
});

describe('levels, referrals, leaderboards, achievements (integration)', () => {
  it('grants XP once per source and level rewards once per level', async () => {
    const { me } = await newPlayer(app, 'lvl');
    const levels = app.get(LevelsService);
    const src = newId();
    const r1 = await levels.addForWager(me.id, 2200, 'test', src);
    expect(r1?.level).toBe(5);
    expect(r1?.levelsGained).toEqual([2, 3, 4, 5]);
    expect(await levels.addForWager(me.id, 2200, 'test', src)).toBeNull();
    expect(await userBalance(app, me.id)).toBe(10 + 15 + 20 + 25);
    expect(await app.get(EntitlementsService).count(me.id, 'wheel_spin')).toBe(1);
    const info = await levels.info(me.id);
    expect(info.xp).toBe(2200);
    expect(info.nextLevelXp).toBeGreaterThan(2200);
  });

  it('pays the referrer a percent of the deposit once', async () => {
    const a = await newPlayer(app, 'refa');
    const b = await newPlayer(app, 'refb');
    await db(app).update(users).set({ referredById: a.me.id }).where(eq(users.id, b.me.id));
    const dep = await deposit(b.client, 20);
    const referral = app.get(ReferralService);
    const paid = await referral.onDeposit(dep.id, b.me.id, dep.gemsAmount);
    expect(paid).toBe(Math.floor(dep.gemsAmount * 0.05));
    expect(await referral.onDeposit(dep.id, b.me.id, dep.gemsAmount)).toBe(0);
    expect(await userBalance(app, a.me.id)).toBe(paid);
    const info = await referral.info(a.me.id);
    expect(info.invited).toBe(1);
    expect(info.earned).toBe(paid);
  });

  it('finalizes a leaderboard period once and pays the prizes', async () => {
    const svc = app.get(LeaderboardService);
    const cs2 = await gameId(app, 'cs2');
    const [lb] = await db(app)
      .select()
      .from(leaderboards)
      .where(and(eq(leaderboards.gameId, cs2), eq(leaderboards.period, 'day')));
    const start = new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 7000) * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    const [it] = await db(app)
      .select({ id: items.id })
      .from(items)
      .where(eq(items.gameId, cs2))
      .limit(1);
    const p1 = await newPlayer(app, 'lb1');
    const p2 = await newPlayer(app, 'lb2');
    for (const [p, value] of [
      [p1, 900],
      [p2, 400],
    ] as const) {
      await db(app)
        .insert(userItems)
        .values({
          id: newId(),
          userId: p.me.id,
          gameId: cs2,
          itemId: it!.id,
          acquiredValue: value,
          sourceType: 'case',
          acquiredAt: new Date(start.getTime() + 3_600_000),
        });
    }
    expect(await svc.finalize(lb!, start, end)).toBe(true);
    expect(await svc.finalize(lb!, start, end)).toBe(false);
    expect(await userBalance(app, p1.me.id)).toBe(500);
    expect(await userBalance(app, p2.me.id)).toBe(300);
    const n = (await p1.client.get<NotificationsDto>('/api/v1/notifications')).body;
    expect(n.items.some((x) => x.type === 'leaderboard_prize')).toBe(true);
    const board = (await p1.client.get<LeaderboardsDto>('/api/v1/games/cs2/leaderboards')).body;
    expect(board.day?.prizes[0]?.amount).toBe(500);
    expect(board.week).not.toBeNull();
  });

  it('unlocks achievements and notifies, notifications can be marked read', async () => {
    const { client, me } = await newPlayer(app, 'ach');
    await grantGems(app, me.id, 1000);
    const [c] = await db(app)
      .select({ slug: cases.slug })
      .from(cases)
      .innerJoin(games, eq(games.id, cases.gameId))
      .where(and(eq(games.code, 'cs2'), eq(cases.kind, 'paid'), sql`${cases.price} <= 200`))
      .limit(1);
    const opened = await client.post(`/api/v1/games/cs2/cases/${c!.slug}/open`, { count: 1 }, IK());
    expect(opened.status).toBe(200);
    const unlocked = await app.get(AchievementsService).evaluate(me.id);
    expect(unlocked).toContain('first_case');
    const list = (await client.get<AchievementDto[]>('/api/v1/me/achievements')).body;
    expect(list.find((a) => a.code === 'first_case')?.unlockedAt).not.toBeNull();
    expect(list.find((a) => a.code === 'cases_100')?.progress).toBe(1);
    const n = (await client.get<NotificationsDto>('/api/v1/notifications')).body;
    expect(n.unread).toBeGreaterThan(0);
    const read = await client.post<{ unread: number }>('/api/v1/notifications/read', {});
    expect(read.body.unread).toBe(0);
  });
});
