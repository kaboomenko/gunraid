import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { battles, userItems } from '@gunraid/db';
import {
  battleClientSeed,
  battleRoll,
  pickByTicket,
  resolveBattle,
  ticketFromFloat,
  verifyServerSeed,
} from '@gunraid/game-core';
import type {
  BattleCaseOptionDto,
  BattleDto,
  BattleProofDto,
  InventoryPageDto,
  PageDto,
  UserItemDto,
} from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestClient } from '../../test/app.js';
import { db, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { BattlesService } from './battles.service.js';

let app: NestFastifyApplication;
let cheap: BattleCaseOptionDto;
let options: BattleCaseOptionDto[];
type Err = { error: { code: string } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
  const anon = (await newPlayer(app, 'bopt')).client;
  options = (await anon.get<BattleCaseOptionDto[]>('/api/v1/games/cs2/battles/cases')).body;
  cheap = options[0]!;
});
afterAll(async () => {
  await app.close();
});

async function createBattle(
  client: TestClient,
  body: { cases: Array<{ caseId: string; count: number }>; format: string; mode: string },
) {
  return client.post<BattleDto>('/api/v1/games/cs2/battles', body, IK());
}

describe('battles (integration)', () => {
  it('lists only regular paid cases as battle options', () => {
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o.price).toBeGreaterThan(0);
  });

  it('create debits the entry price; cancel refunds exactly once', async () => {
    const { client, me } = await newPlayer(app, 'bc');
    await grantGems(app, me.id, 10_000);
    const res = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 2 }],
      format: '1v1',
      mode: 'classic',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('waiting');
    expect(res.body.entryPrice).toBe(cheap.price * 2);
    expect(res.body.rounds).toHaveLength(2);
    expect(res.body.players[0]?.user?.id).toBe(me.id);
    expect(res.body.players[1]).toBeNull();
    expect(res.body.serverSeed).toBeNull();
    expect(res.body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await userBalance(app, me.id)).toBe(10_000 - cheap.price * 2);

    const [c1, c2] = await Promise.all([
      client.post<BattleDto>(`/api/v1/battles/${res.body.id}/cancel`),
      client.post<BattleDto>(`/api/v1/battles/${res.body.id}/cancel`),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    expect(await userBalance(app, me.id)).toBe(10_000);
    const after = await client.get<BattleDto>(`/api/v1/battles/${res.body.id}`);
    expect(after.body.status).toBe('cancelled');
  });

  it('rejects other users cancelling and unavailable cases', async () => {
    const { client, me } = await newPlayer(app, 'bv');
    await grantGems(app, me.id, 10_000);
    const created = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 1 }],
      format: '1v1',
      mode: 'classic',
    });
    const other = await newPlayer(app, 'bv2');
    const cancel = await other.client.post<Err>(`/api/v1/battles/${created.body.id}/cancel`);
    expect(cancel.status).toBe(403);
    expect(cancel.body.error.code).toBe('BATTLE_NOT_CREATOR');

    const tooMany = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 26 }],
      format: '1v1',
      mode: 'classic',
    });
    expect(tooMany.status).toBe(400);
    expect((tooMany.body as unknown as Err).error.code).toBe('BATTLE_CASES_INVALID');

    const poor = await newPlayer(app, 'bpoor');
    const noMoney = await createBattle(poor.client, {
      cases: [{ caseId: cheap.id, count: 1 }],
      format: '1v1',
      mode: 'classic',
    });
    expect(noMoney.status).toBe(402);
    const rows = (
      await db(app).execute(
        sql`select count(*)::int as n from battles where creator_id = ${poor.me.id}`,
      )
    ).rows as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);
  });

  it('only one of several players gets the last slot; the battle starts', async () => {
    const creator = await newPlayer(app, 'bj');
    await grantGems(app, creator.me.id, 5_000);
    const created = await createBattle(creator.client, {
      cases: [{ caseId: cheap.id, count: 1 }],
      format: '1v1',
      mode: 'classic',
    });
    const players = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const p = await newPlayer(app, `bjp${i}`);
        await grantGems(app, p.me.id, 5_000);
        return p;
      }),
    );
    const results = await Promise.all(
      players.map((p) =>
        p.client.post<BattleDto>(`/api/v1/battles/${created.body.id}/join`, {}, IK()),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(['BATTLE_FULL', 'BATTLE_NOT_WAITING']).toContain(
        (r.body as unknown as Err).error.code,
      );
    }
    const balances = await Promise.all(players.map((p) => userBalance(app, p.me.id)));
    expect(balances.filter((b) => b === 5_000 - cheap.price)).toHaveLength(1);
    expect(balances.filter((b) => b === 5_000)).toHaveLength(5);

    const state = await creator.client.get<BattleDto>(`/api/v1/battles/${created.body.id}`);
    expect(state.body.status).toBe('in_progress');
    expect(state.body.clientSeed).toMatch(/^[0-9a-f]{64}$/);
    // Раунды ещё не начались (обратный отсчёт) — результатов не видно.
    expect(state.body.drops).toHaveLength(0);
    expect(state.body.players.every((p) => p?.isWinner === null)).toBe(true);

    const again = await creator.client.post<Err>(
      `/api/v1/battles/${created.body.id}/join`,
      {},
      IK(),
    );
    expect(again.status).toBe(409);
  });

  it('a repeated join with the same idempotency key charges once', async () => {
    const creator = await newPlayer(app, 'bi');
    await grantGems(app, creator.me.id, 5_000);
    const created = await createBattle(creator.client, {
      cases: [{ caseId: cheap.id, count: 1 }],
      format: '1v1v1',
      mode: 'classic',
    });
    const p = await newPlayer(app, 'bip');
    await grantGems(app, p.me.id, 5_000);
    const key = IK();
    const [a, b] = await Promise.all([
      p.client.post<BattleDto>(`/api/v1/battles/${created.body.id}/join`, {}, key),
      p.client.post<BattleDto>(`/api/v1/battles/${created.body.id}/join`, {}, key),
    ]);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(await userBalance(app, p.me.id)).toBe(5_000 - cheap.price);
  });

  it('bots fill the lobby; the winner gets every drop; rounds are verifiable', async () => {
    const { client, me } = await newPlayer(app, 'bb');
    await grantGems(app, me.id, 50_000);
    const second = options[1] ?? cheap;
    const created = await createBattle(client, {
      cases: [
        { caseId: cheap.id, count: 2 },
        { caseId: second.id, count: 1 },
      ],
      format: '1v1v1',
      mode: 'classic',
    });
    const started = await client.post<BattleDto>(`/api/v1/battles/${created.body.id}/bots`, {
      clientSeed: 'browser-seed-123',
    });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('in_progress');
    expect(started.body.players.filter((p) => p?.bot)).toHaveLength(2);

    const service = app.get(BattlesService);
    const round0 = await service.roundEvent(created.body.id, 0);
    expect(round0?.drops).toHaveLength(3);
    const fin = await service.finalize(created.body.id);
    expect(fin?.battleId).toBe(created.body.id);
    expect(await service.finalize(created.body.id)).toBeNull(); // повтор — без эффекта

    const done = (await client.get<BattleDto>(`/api/v1/battles/${created.body.id}`)).body;
    expect(done.status).toBe('finished');
    expect(done.drops).toHaveLength(9);
    expect(done.serverSeed).not.toBeNull();
    expect(verifyServerSeed(done.serverSeed!, done.serverSeedHash)).toBe(true);
    const totals = [0, 1, 2].map((s) =>
      done.drops.filter((d) => d.slot === s).reduce((a, d) => a + d.value, 0),
    );
    expect(done.players.map((p) => p?.total)).toEqual(totals);
    expect(done.totalValue).toBe(totals.reduce((a, v) => a + v, 0));
    const winner = done.winnerSlots![0]!;
    expect(totals[winner]).toBe(Math.max(...totals));
    expect(done.drops.every((d) => d.recipientSlot === winner)).toBe(true);
    expect(done.players[winner]?.payout).toBe(done.totalValue);

    const inv = (await client.get<InventoryPageDto>('/api/v1/games/cs2/inventory?pageSize=60'))
      .body;
    const fromBattle = inv.items.filter((i) => i.source === 'battle');
    const history = (
      await client.get<PageDto<UserItemDto>>('/api/v1/me/history/drops?game=cs2')
    ).body.items.filter((i) => i.source === 'battle');
    if (winner === 0) {
      expect(fromBattle).toHaveLength(9);
    } else {
      expect(fromBattle).toHaveLength(0);
      expect(history.filter((i) => i.status === 'lost_battle')).toHaveLength(3);
    }

    // Provably fair: пересчёт каждого раунда в «браузере».
    const proof = (await client.get<BattleProofDto>(`/api/v1/fair/proof/battle/${done.id}`)).body;
    expect(proof.revealed).toBe(true);
    expect(battleClientSeed(proof.slotSeeds)).toBe(proof.clientSeed);
    for (const r of proof.rounds) {
      for (const d of r.drops) {
        const ticket = ticketFromFloat(
          battleRoll(proof.serverSeed!, proof.clientSeed!, r.round, d.slot),
        );
        expect(ticket).toBe(d.ticket);
        expect(pickByTicket(r.contents, ticket).itemId).toBe(d.itemId);
      }
    }
    const res = resolveBattle(proof.format, proof.mode, totals, proof.tiebreakRoll!);
    expect(res.winnerSlots).toEqual(proof.winnerSlots);
  });

  it('crazy mode: the lowest total wins', async () => {
    const { client, me } = await newPlayer(app, 'bcz');
    await grantGems(app, me.id, 50_000);
    const created = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 3 }],
      format: '1v1v1v1',
      mode: 'crazy',
    });
    await client.post(`/api/v1/battles/${created.body.id}/bots`, {});
    await app.get(BattlesService).finalize(created.body.id);
    const done = (await client.get<BattleDto>(`/api/v1/battles/${created.body.id}`)).body;
    const totals = done.players.map((p) => p!.total);
    const winner = done.winnerSlots![0]!;
    expect(totals[winner]).toBe(Math.min(...totals));
  });

  it('2v2: each winner takes own drops and the paired opponent slot', async () => {
    const a = await newPlayer(app, 'b2a');
    const b = await newPlayer(app, 'b2b');
    await grantGems(app, a.me.id, 50_000);
    await grantGems(app, b.me.id, 50_000);
    const created = await createBattle(a.client, {
      cases: [{ caseId: cheap.id, count: 2 }],
      format: '2v2',
      mode: 'classic',
    });
    const joined = await b.client.post<BattleDto>(
      `/api/v1/battles/${created.body.id}/join`,
      { slot: 1 },
      IK(),
    );
    expect(joined.status).toBe(200);
    expect(joined.body.players[1]?.team).toBe(0);
    await a.client.post(`/api/v1/battles/${created.body.id}/bots`, {});
    await app.get(BattlesService).finalize(created.body.id);
    const done = (await a.client.get<BattleDto>(`/api/v1/battles/${created.body.id}`)).body;
    const team0 = done.players[0]!.total + done.players[1]!.total;
    const team1 = done.players[2]!.total + done.players[3]!.total;
    const winners = done.winnerSlots!;
    if (team0 !== team1) expect(winners).toEqual(team0 > team1 ? [0, 1] : [2, 3]);
    const pair = (s: number) => (winners.includes(s) ? s : (s + 2) % 4);
    for (const d of done.drops) expect(d.recipientSlot).toBe(pair(d.slot));
    if (winners[0] === 0) {
      const invA = (await a.client.get<InventoryPageDto>('/api/v1/games/cs2/inventory')).body;
      expect(invA.items.filter((i) => i.source === 'battle')).toHaveLength(4);
    }
  });

  it('an expired lobby is closed with a refund', async () => {
    const { client, me } = await newPlayer(app, 'bexp');
    await grantGems(app, me.id, 5_000);
    const created = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 1 }],
      format: '1v1',
      mode: 'classic',
    });
    const service = app.get(BattlesService);
    expect(await service.expire(created.body.id)).toBeNull(); // ещё не истёк
    await db(app)
      .update(battles)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(battles.id, created.body.id));
    const res = await service.expire(created.body.id);
    expect(res?.balances[0]?.balance).toBe(5_000);
    expect(await userBalance(app, me.id)).toBe(5_000);
    expect(
      (await client.get<BattleDto>(`/api/v1/battles/${created.body.id}`)).body.cancelReason,
    ).toBe('timeout');
  });

  it('reveals rounds by time while the battle is running', async () => {
    const { client, me } = await newPlayer(app, 'brev');
    await grantGems(app, me.id, 50_000);
    const created = await createBattle(client, {
      cases: [{ caseId: cheap.id, count: 3 }],
      format: '1v1',
      mode: 'classic',
    });
    await client.post(`/api/v1/battles/${created.body.id}/bots`, {});
    const [b] = await db(app).select().from(battles).where(eq(battles.id, created.body.id));
    // Сдвигаем старт в прошлое: идёт второй раунд.
    const startsAt = new Date(Date.now() - b!.roundDurationMs - 100);
    await db(app).update(battles).set({ startsAt }).where(eq(battles.id, created.body.id));
    const state = (await client.get<BattleDto>(`/api/v1/battles/${created.body.id}`)).body;
    expect(state.revealedRounds).toBe(2);
    expect(state.drops).toHaveLength(4);
    expect(state.players.every((p) => p?.isWinner === null)).toBe(true);
    expect(state.drops.every((d) => d.recipientSlot === null)).toBe(true);
    const owned = await db(app)
      .select({ id: userItems.id })
      .from(userItems)
      .where(and(eq(userItems.userId, me.id), eq(userItems.sourceType, 'battle')));
    expect(owned).toHaveLength(0); // предметы выдаются только после последнего раунда
  });
});
