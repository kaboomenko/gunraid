import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cases, games, users } from '@gunraid/db';
import { pickByTicket, rollFloat, sha256Hex, ticketFromFloat } from '@gunraid/game-core';
import type {
  CaseDetailDto,
  CaseOpenResultDto,
  CaseOpeningProofDto,
  FairSeedDto,
  HomeDto,
  InventoryPageDto,
  RotateSeedResultDto,
} from '@gunraid/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';
import { db, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { LedgerService } from '../ledger/ledger.service.js';

let app: NestFastifyApplication;
type Err = { error: { code: string; details?: Record<string, unknown> } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

async function caseRow(game: string, slug: string) {
  const [row] = await db(app)
    .select({ c: cases })
    .from(cases)
    .innerJoin(games, eq(games.id, cases.gameId))
    .where(and(eq(games.code, game), eq(cases.slug, slug)));
  if (!row) throw new Error('case missing');
  return row.c;
}

describe('cases (integration)', () => {
  it('lists categories with cases and shows odds summing to 100%', async () => {
    const c = new TestClient(app);
    const home = await c.get<HomeDto>('/api/v1/games/standoff2/home');
    expect(home.status).toBe(200);
    expect(home.body.categories.map((x) => x.code)).toContain('snowfall');
    expect(home.body.banners.length).toBeGreaterThan(0);
    const detail = await c.get<CaseDetailDto>('/api/v1/games/standoff2/cases/juicy-drop');
    expect(detail.status).toBe(200);
    expect(detail.body.items.reduce((s, i) => s + i.odds, 0)).toBe(10_000_000);
    expect(detail.body.availability).toMatchObject({ canOpen: false, reason: 'LOGIN' });
    expect((await c.get('/api/v1/games/cs2/cases/no-such-case')).status).toBe(404);
  });

  it('opens x3, charges once per case and the result is verifiable after rotating seeds', async () => {
    const { client, me } = await newPlayer(app, 'open');
    const kase = await caseRow('standoff2', 'juicy-drop');
    await grantGems(app, me.id, kase.price * 3);
    const seedBefore = (await client.get<FairSeedDto>('/api/v1/fair/seed')).body;

    const res = await client.post<CaseOpenResultDto>(
      '/api/v1/games/standoff2/cases/juicy-drop/open',
      { count: 3 },
      IK(),
    );
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.balance).toBe(0);
    expect(res.body.fair.serverSeedHash).toBe(seedBefore.serverSeedHash);
    expect(res.body.results.map((r) => r.nonce)).toEqual([
      seedBefore.nonce,
      seedBefore.nonce + 1,
      seedBefore.nonce + 2,
    ]);

    const inv = await client.get<InventoryPageDto>('/api/v1/games/standoff2/inventory');
    expect(inv.body.total).toBe(3);

    // До смены пары server seed скрыт.
    const hidden = await client.get<CaseOpeningProofDto>(
      `/api/v1/fair/proof/case_opening/${res.body.results[0]!.openingId}`,
    );
    expect(hidden.body.serverSeed).toBeNull();

    const rotated = await client.post<RotateSeedResultDto>('/api/v1/fair/rotate');
    expect(sha256Hex(rotated.body.revealed.serverSeed)).toBe(seedBefore.serverSeedHash);
    expect(rotated.body.current.serverSeedHash).not.toBe(seedBefore.serverSeedHash);

    for (const r of res.body.results) {
      const proof = (
        await client.get<CaseOpeningProofDto>(`/api/v1/fair/proof/case_opening/${r.openingId}`)
      ).body;
      expect(proof.revealed).toBe(true);
      const ticket = ticketFromFloat(
        rollFloat(proof.serverSeed as string, proof.clientSeed, proof.nonce),
      );
      expect(ticket).toBe(proof.ticket);
      expect(pickByTicket(proof.contents, ticket).itemId).toBe(r.item.id);
    }
  });

  it('rejects opening without enough gems and leaves inventory unchanged', async () => {
    const { client } = await newPlayer(app, 'poor');
    const res = await client.post<Err>('/api/v1/games/cs2/cases/raid-step/open', { count: 1 }, IK());
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    const inv = await client.get<InventoryPageDto>('/api/v1/games/cs2/inventory');
    expect(inv.body.total).toBe(0);
  });

  it('opens exactly as many cases as the balance allows under parallel requests', async () => {
    const { client, me } = await newPlayer(app, 'par');
    const kase = await caseRow('cs2', 'stellar-start');
    await grantGems(app, me.id, kase.price * 3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.post<CaseOpenResultDto | Err>(
          '/api/v1/games/cs2/cases/stellar-start/open',
          { count: 1 },
          IK(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await userBalance(app, me.id)).toBe(0);
    expect(await app.get(LedgerService).reconcile()).toEqual([]);
  });

  it('is idempotent for a repeated request key', async () => {
    const { client, me } = await newPlayer(app, 'idem');
    const kase = await caseRow('cs2', 'stellar-start');
    await grantGems(app, me.id, kase.price * 2);
    const headers = IK();
    const a = await client.post<CaseOpenResultDto>(
      '/api/v1/games/cs2/cases/stellar-start/open',
      { count: 1 },
      headers,
    );
    const b = await client.post<CaseOpenResultDto>(
      '/api/v1/games/cs2/cases/stellar-start/open',
      { count: 1 },
      headers,
    );
    expect(b.body.batchId).toBe(a.body.batchId);
    expect(await userBalance(app, me.id)).toBe(kase.price);
  });

  it('enforces the free case cooldown, also under concurrency', async () => {
    const { client } = await newPlayer(app, 'free');
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.post<CaseOpenResultDto | Err>(
          '/api/v1/games/standoff2/cases/ezhednevnyy/open',
          { count: 1 },
          IK(),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    const denied = results.find((r) => r.status !== 200)!.body as Err;
    expect(denied.error.code).toBe('CASE_COOLDOWN');
    const detail = await client.get<CaseDetailDto>('/api/v1/games/standoff2/cases/ezhednevnyy');
    expect(detail.body.availability.reason).toBe('COOLDOWN');
    const multi = await client.post<Err>(
      '/api/v1/games/cs2/cases/ezhednevnyy/open',
      { count: 2 },
      IK(),
    );
    expect(multi.body.error.code).toBe('CASE_OPEN_COUNT_INVALID');
  });

  it('requires the level for level cases', async () => {
    const { client, me } = await newPlayer(app, 'lvl');
    const denied = await client.post<Err>(
      '/api/v1/games/standoff2/cases/uroven-5/open',
      { count: 1 },
      IK(),
    );
    expect(denied.body.error.code).toBe('CASE_LEVEL_REQUIRED');
    await db(app).update(users).set({ level: 5 }).where(eq(users.id, me.id));
    const ok = await client.post<CaseOpenResultDto>(
      '/api/v1/games/standoff2/cases/uroven-5/open',
      { count: 1 },
      IK(),
    );
    expect(ok.status).toBe(200);
  });

  it('never sells more than the limited supply', async () => {
    const kase = await caseRow('standoff2', 'snow-avalanche');
    await db(app)
      .update(cases)
      .set({ supplyTotal: kase.supplyUsed + 2 })
      .where(eq(cases.id, kase.id));
    try {
      const players = await Promise.all(
        Array.from({ length: 5 }, (_, i) => newPlayer(app, `lim${i}`)),
      );
      for (const p of players) await grantGems(app, p.me.id, kase.price);
      const results = await Promise.all(
        players.map((p) =>
          p.client.post<CaseOpenResultDto | Err>(
            '/api/v1/games/standoff2/cases/snow-avalanche/open',
            { count: 1 },
            IK(),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(2);
      expect(results.filter((r) => (r.body as Err).error?.code === 'CASE_SOLD_OUT')).toHaveLength(
        3,
      );
      // Тем, кому не хватило тиража, гемы не списаны.
      const balances = await Promise.all(players.map((p) => userBalance(app, p.me.id)));
      expect(balances.filter((b) => b === kase.price)).toHaveLength(3);
    } finally {
      await db(app)
        .update(cases)
        .set({ supplyTotal: kase.supplyTotal })
        .where(eq(cases.id, kase.id));
    }
  });

  it('changes the client seed only together with a new pair', async () => {
    const { client } = await newPlayer(app, 'seed');
    const bad = await client.put<Err>('/api/v1/fair/client-seed', { clientSeed: 'with space' });
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const ok = await client.put<RotateSeedResultDto>('/api/v1/fair/client-seed', {
      clientSeed: 'my-lucky-seed',
    });
    expect(ok.body.current.clientSeed).toBe('my-lucky-seed');
    expect(ok.body.current.nonce).toBe(0);
  });
});
