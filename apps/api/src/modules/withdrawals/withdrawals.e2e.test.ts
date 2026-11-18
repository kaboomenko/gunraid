import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { adminAuditLog, items, userItems, users, withdrawals } from '@gunraid/db';
import type {
  AdminWithdrawalDto,
  DepositDto,
  DepositQuoteDto,
  WithdrawalDto,
  WithdrawalRequirementsDto,
} from '@gunraid/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TestClient } from '../../test/app.js';
import { db, gameId, newPlayer } from '../../test/fixtures.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

let app: NestFastifyApplication;
let admin: TestClient;
let support: TestClient;
type Err = { error: { code: string; details?: Record<string, unknown> } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });
const TRADE_URL = 'https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=AbCdEf12';

beforeAll(async () => {
  app = await createTestApp();
  admin = new TestClient(app);
  await admin.devLogin('admin');
  support = new TestClient(app);
  await support.devLogin('support');
});
afterAll(async () => {
  await app.close();
});

async function deposit(client: TestClient, usd: number) {
  const q = await client.post<DepositQuoteDto>('/api/v1/deposits/quote', {
    method: 'card',
    currency: 'USD',
    amount: String(usd),
  });
  const d = await client.post<DepositDto>('/api/v1/deposits', { quoteId: q.body.quoteId }, IK());
  await client.post(`/api/v1/payments/mock/${d.body.id}/complete`, { result: 'success' });
}

/** Игрок, готовый к выводу: профиль игры, пополнение старше суток, предмет в инвентаре. */
async function readyPlayer(game: 'cs2' | 'standoff2') {
  const p = await newPlayer(app, `wd${game.slice(0, 2)}`);
  await p.client.put(
    `/api/v1/me/games/${game}/profile`,
    game === 'cs2' ? { tradeUrl: TRADE_URL } : { playerId: '12345678' },
  );
  await deposit(p.client, 5);
  await db(app)
    .update(users)
    .set({
      firstDepositAt: new Date(Date.now() - 2 * 86_400_000),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    })
    .where(eq(users.id, p.me.id));
  const gid = await gameId(app, game);
  const [it] = await db(app)
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(eq(items.gameId, gid), eq(items.isWithdrawable, true), eq(items.isActive, true)))
    .limit(1);
  const userItemId = await db(app).transaction((tx) =>
    app.get(InventoryService).grant(tx, {
      userId: p.me.id,
      gameId: gid,
      itemId: it!.id,
      value: it!.price,
      sourceType: 'admin',
    }),
  );
  return { ...p, userItemId };
}

async function itemStatus(userItemId: string) {
  const [row] = await db(app)
    .select({ s: userItems.status })
    .from(userItems)
    .where(eq(userItems.id, userItemId));
  return row?.s;
}

describe('withdrawals (integration)', () => {
  it('checks profile, deposit and delay requirements', async () => {
    const { client, me } = await newPlayer(app, 'wdreq');
    const gid = await gameId(app, 'cs2');
    const [it] = await db(app)
      .select({ id: items.id, price: items.price })
      .from(items)
      .where(eq(items.gameId, gid))
      .limit(1);
    const userItemId = await db(app).transaction((tx) =>
      app.get(InventoryService).grant(tx, {
        userId: me.id,
        gameId: gid,
        itemId: it!.id,
        value: it!.price,
        sourceType: 'admin',
      }),
    );
    const r1 = await client.post<Err>('/api/v1/games/cs2/withdrawals', { userItemId }, IK());
    expect(r1.body.error.code).toBe('WITHDRAW_PROFILE_REQUIRED');
    await client.put('/api/v1/me/games/cs2/profile', { tradeUrl: TRADE_URL });
    const r2 = await client.post<Err>('/api/v1/games/cs2/withdrawals', { userItemId }, IK());
    expect(r2.body.error.code).toBe('WITHDRAW_DEPOSIT_REQUIRED');
    await deposit(client, 5);
    const r3 = await client.post<Err>('/api/v1/games/cs2/withdrawals', { userItemId }, IK());
    expect(r3.body.error.code).toBe('WITHDRAW_DELAY');
    const req = (
      await client.get<WithdrawalRequirementsDto>('/api/v1/games/cs2/withdrawals/requirements')
    ).body;
    expect(req.targetSet).toBe(true);
    expect(req.availableAt).not.toBeNull();
    expect(await itemStatus(userItemId)).toBe('in_inventory');
  });

  it('locks the item once; CS2 stub flow with a reversed trade returns the item', async () => {
    const p = await readyPlayer('cs2');
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        p.client.post<WithdrawalDto>(
          '/api/v1/games/cs2/withdrawals',
          { userItemId: p.userItemId },
          IK(),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    const w = ok[0]!.body;
    expect(w.status).toBe('pending_review');
    expect(await itemStatus(p.userItemId)).toBe('withdrawing');

    // Обычный игрок не видит очередь
    expect((await p.client.get('/api/v1/admin/withdrawals')).status).toBe(403);
    // support может обработать вывод
    const approved = await support.post<AdminWithdrawalDto>(
      `/api/v1/admin/withdrawals/${w.id}/approve`,
      {},
    );
    expect(approved.body.status).toBe('purchasing');
    await admin.post(`/api/v1/admin/withdrawals/${w.id}/simulate`, { event: 'trade_sent' });
    const acc = await admin.post<AdminWithdrawalDto>(`/api/v1/admin/withdrawals/${w.id}/simulate`, {
      event: 'trade_accepted',
    });
    expect(acc.body.status).toBe('trade_accepted');
    expect(acc.body.protectedUntil).not.toBeNull();
    const rev = await admin.post<AdminWithdrawalDto>(`/api/v1/admin/withdrawals/${w.id}/simulate`, {
      event: 'reverse',
    });
    expect(rev.body.status).toBe('reversed');
    expect(await itemStatus(p.userItemId)).toBe('in_inventory');
    const mine = (await p.client.get<WithdrawalDto>(`/api/v1/withdrawals/${w.id}`)).body;
    expect(mine.events.map((e) => e.toStatus)).toEqual([
      'pending_review',
      'purchasing',
      'trade_sent',
      'trade_accepted',
      'reversed',
    ]);
  });

  it('completes CS2 after the protection period (worker tick)', async () => {
    const p = await readyPlayer('cs2');
    const w = (
      await p.client.post<WithdrawalDto>(
        '/api/v1/games/cs2/withdrawals',
        { userItemId: p.userItemId },
        IK(),
      )
    ).body;
    await admin.post(`/api/v1/admin/withdrawals/${w.id}/approve`, {});
    await admin.post(`/api/v1/admin/withdrawals/${w.id}/simulate`, { event: 'trade_sent' });
    await admin.post(`/api/v1/admin/withdrawals/${w.id}/simulate`, { event: 'trade_accepted' });
    await db(app)
      .update(withdrawals)
      .set({ protectedUntil: new Date(Date.now() - 1000) })
      .where(eq(withdrawals.id, w.id));
    await app.get(WithdrawalsService).tick();
    const done = (await p.client.get<WithdrawalDto>(`/api/v1/withdrawals/${w.id}`)).body;
    expect(done.status).toBe('completed');
    expect(await itemStatus(p.userItemId)).toBe('withdrawn');
    // Попытка отменить завершённый — ошибка состояния
    const bad = await admin.post<Err>(`/api/v1/admin/withdrawals/${w.id}/reject`, {
      reason: 'late',
    });
    expect(bad.body.error.code).toBe('WITHDRAWAL_INVALID_STATE');
  });

  it('Standoff 2 manual flow: gold price, listing, operator confirmation; timeouts return the item', async () => {
    const p = await readyPlayer('standoff2');
    const w = (
      await p.client.post<WithdrawalDto>(
        '/api/v1/games/standoff2/withdrawals',
        { userItemId: p.userItemId },
        IK(),
      )
    ).body;
    const noPrice = await admin.post<Err>(`/api/v1/admin/withdrawals/${w.id}/approve`, {});
    expect(noPrice.status).toBe(400);
    const ok = await admin.post<AdminWithdrawalDto>(`/api/v1/admin/withdrawals/${w.id}/approve`, {
      priceGold: 150,
    });
    expect(ok.body.status).toBe('awaiting_listing');
    expect(ok.body.priceGold).toBe(150);
    expect(ok.body.expiresAt).not.toBeNull();
    const listed = await p.client.post<WithdrawalDto>(`/api/v1/withdrawals/${w.id}/listing`, {
      reference: 'LOT-777',
    });
    expect(listed.body.status).toBe('listing_submitted');
    const done = await admin.post<AdminWithdrawalDto>(
      `/api/v1/admin/withdrawals/${w.id}/confirm-purchase`,
    );
    expect(done.body.status).toBe('completed');
    expect(await itemStatus(p.userItemId)).toBe('withdrawn');

    const p2 = await readyPlayer('standoff2');
    const w2 = (
      await p2.client.post<WithdrawalDto>(
        '/api/v1/games/standoff2/withdrawals',
        { userItemId: p2.userItemId },
        IK(),
      )
    ).body;
    await admin.post(`/api/v1/admin/withdrawals/${w2.id}/approve`, { priceGold: 99 });
    await db(app)
      .update(withdrawals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(withdrawals.id, w2.id));
    await app.get(WithdrawalsService).tick();
    expect((await p2.client.get<WithdrawalDto>(`/api/v1/withdrawals/${w2.id}`)).body.status).toBe(
      'expired',
    );
    expect(await itemStatus(p2.userItemId)).toBe('in_inventory');
  });

  it('a user can cancel a pending withdrawal; rejection is audited', async () => {
    const p = await readyPlayer('cs2');
    const w = (
      await p.client.post<WithdrawalDto>(
        '/api/v1/games/cs2/withdrawals',
        { userItemId: p.userItemId },
        IK(),
      )
    ).body;
    const c = await p.client.post<WithdrawalDto>(`/api/v1/withdrawals/${w.id}/cancel`);
    expect(c.body.status).toBe('cancelled');
    expect(await itemStatus(p.userItemId)).toBe('in_inventory');

    const w2 = (
      await p.client.post<WithdrawalDto>(
        '/api/v1/games/cs2/withdrawals',
        { userItemId: p.userItemId },
        IK(),
      )
    ).body;
    const rej = await admin.post<AdminWithdrawalDto>(`/api/v1/admin/withdrawals/${w2.id}/reject`, {
      reason: 'Проверка аккаунта',
    });
    expect(rej.body.status).toBe('rejected');
    expect(rej.body.reason).toBe('Проверка аккаунта');
    const audit = await db(app)
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.entityType, 'withdrawal'), eq(adminAuditLog.entityId, w2.id)));
    expect(audit.some((a) => a.action === 'withdrawal.reject')).toBe(true);
  });
});
