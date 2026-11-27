import { randomBytes } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  adminAuditLog,
  cargoPurchases,
  cargoRounds,
  cargoTemplates,
  idempotencyRequests,
  items,
  ledgerEntries,
  newId,
  outboxEvents,
  userItems,
} from '@gunraid/db';
import {
  cargoClientSeed,
  cargoSeatOwner,
  cargoWinningSeat,
  verifyServerSeed,
} from '@gunraid/game-core';
import type {
  CargoBuyResultDto,
  CargoDetailDto,
  CargoListDto,
  CargoMismatchDto,
  CargoProofDto,
  DepositDto,
  DepositQuoteDto,
  InventoryPageDto,
} from '@gunraid/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestClient, createTestApp } from '../../test/app.js';
import { db, gameId, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { OutboxProcessor } from '../outbox/outbox.processor.js';
import { reconcileCargo } from './cargo-recon.js';
import { CargoHandlers } from './cargo.handlers.js';
import type { CargoNotifier } from './cargo.notifier.js';
import { CargoService, type CargoLanding, type CargoOpened } from './cargo.service.js';

let app: NestFastifyApplication;
type Err = { error: { code: string; details?: Record<string, unknown> } };
const IK = () => ({ 'idempotency-key': crypto.randomUUID() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const svc = () => app.get(CargoService);

beforeAll(async () => {
  app = await createTestApp();
});

// Тестовая БД общая между запусками: каждый тест создаёт свой шаблон, afterAll его убирает.
const created: string[] = [];
async function createCargo(over: Partial<typeof cargoTemplates.$inferInsert> = {}) {
  const gid = await gameId(app, 'cs2');
  const [item] = await db(app)
    .select({ id: items.id, price: items.price, fullName: items.fullName })
    .from(items)
    .where(and(eq(items.gameId, gid), eq(items.isActive, true)))
    .orderBy(asc(items.price), asc(items.id))
    .limit(1);
  const id = newId();
  const slug = `t-${id.slice(-12)}`;
  await db(app)
    .insert(cargoTemplates)
    .values({
      id,
      gameId: gid,
      slug,
      name: { ru: 'Тестовый груз' },
      imageUrl: '/media/cargo/light.webp',
      prizeItemId: item!.id,
      seatsTotal: 3,
      seatPrice: 100,
      durationMinutes: 60,
      sortOrder: 100_000,
      ...over,
    });
  created.push(id);
  const round = await db(app).transaction((tx) => svc().openRound(tx, id));
  return { id, slug, round: round!, prize: item! };
}
type Cargo = { slug: string; round: { id: string } };

const seed = () => randomBytes(16).toString('hex'); // client seed покупки обязателен (D5)
const buyUrl = (slug: string) => `/api/v1/games/cs2/cargo/${slug}/buy`;
const buy = (
  client: TestClient,
  c: Cargo,
  count: number,
  opts: { seed?: string; key?: string } = {},
) =>
  client.post<CargoBuyResultDto>(
    buyUrl(c.slug),
    { roundId: c.round.id, count, clientSeed: opts.seed ?? seed() },
    { 'idempotency-key': opts.key ?? crypto.randomUUID() },
  );

async function playerWith(gems: number, prefix = 'cg') {
  const p = await newPlayer(app, prefix);
  if (gems > 0) await grantGems(app, p.me.id, gems);
  return p;
}

async function roundRow(id: string) {
  const [r] = await db(app).select().from(cargoRounds).where(eq(cargoRounds.id, id));
  return r!;
}

async function endNow(roundId: string) {
  await db(app)
    .update(cargoRounds)
    .set({ endsAt: sql`now() - interval '1 second'` })
    .where(eq(cargoRounds.id, roundId));
}

async function openRoundOf(templateId: string) {
  const [r] = await db(app)
    .select()
    .from(cargoRounds)
    .where(and(eq(cargoRounds.templateId, templateId), eq(cargoRounds.status, 'open')));
  return r ?? null;
}

async function outbox(type: string, key: string, value: string) {
  return db(app)
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.type, type), sql`${outboxEvents.payload}->>${key} = ${value}`))
    .orderBy(asc(outboxEvents.id));
}

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

/** Логгер сервиса (в тестах вывод выключен, но вызовы видны шпиону). */
const loggerOf = (o: object) => (o as { logger: Logger }).logger;

/**
 * Настоящая ошибка БД при выдаче приза раунда: предмета-приза нет (внешний ключ user_items → items). Drizzle
 * заворачивает её в DrizzleQueryError: в message — SQL и параметры (среди них id победителя), ошибка pg — в cause.
 */
function failPrizeGrant(inventory: InventoryService, roundId: string) {
  const grant = inventory.grant.bind(inventory);
  return vi
    .spyOn(inventory, 'grant')
    .mockImplementation((tx, input) =>
      grant(tx, input.sourceId === roundId ? { ...input, itemId: newId() } : input),
    );
}

/** Текст сбоя — причина из PostgreSQL, без SQL, параметров запроса и id игроков. */
function expectCauseOnly(text: string | null | undefined, userIds: string[]) {
  expect(text).toMatch(/\[23503\] insert or update on table "user_items" violates foreign key/);
  expect(text).not.toMatch(/Failed query|params:|values \(/);
  for (const id of userIds) expect(text).not.toContain(id);
}

/** Имя нарушенного ограничения PostgreSQL (drizzle оборачивает ошибку pg в cause). */
function constraintOf(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

// Уборка: иначе через час открытые раунды прошлых запусков становятся «просроченными», и sweep() в следующих
// запусках тратит на них пачку из 50. Выключить шаблоны и приземлить их открытые раунды обычным путём (инварианты
// ledger и сверки D39 сохраняются; next не откроется — шаблон уже выключен).
afterAll(async () => {
  if (created.length) {
    await db(app)
      .update(cargoTemplates)
      .set({ isActive: false })
      .where(inArray(cargoTemplates.id, created));
    const open = await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() - interval '1 second'` })
      .where(and(inArray(cargoRounds.templateId, created), eq(cargoRounds.status, 'open')))
      .returning({ id: cargoRounds.id });
    for (const { id } of open) await svc().land(id);
  }
  await app.close();
});

describe('cargo (integration)', () => {
  it('public list and detail: open round, commit hash, guest vs player, 404s', async () => {
    const c = await createCargo();
    const guest = new TestClient(app);
    const list = await guest.get<CargoListDto>('/api/v1/games/cs2/cargo');
    expect(list.status).toBe(200);
    const card = list.body.items.find((x) => x.slug === c.slug);
    expect(card).toMatchObject({
      id: c.id,
      name: 'Тестовый груз',
      imageUrl: '/media/cargo/light.webp',
      isFree: false,
      roundId: c.round.id,
      seatsTotal: 3,
      seatsSold: 0,
      seatPrice: 100,
    });
    expect(card!.prize.id).toBe(c.prize.id);
    const endsIn = Date.parse(card!.endsAt) - Date.parse(list.body.serverTime);
    expect(endsIn).toBeGreaterThan(59 * 60_000);
    expect(endsIn).toBeLessThanOrEqual(60 * 60_000 + 5_000);

    const g = await guest.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(g.status).toBe(200);
    expect(g.body.round?.id).toBe(c.round.id);
    expect(g.body.round?.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(g.body.round?.serverSeedHash).toBe(c.round.serverSeedHash);
    expect(g.body.noRound).toBeNull();
    expect(g.body.lastResult).toBeNull();
    expect(g.body.availability).toEqual({
      canBuy: false,
      reason: 'LOGIN',
      mySeats: 0,
      myPurchases: [],
      maxBuy: 3,
    });

    const { client } = await newPlayer(app, 'cgp');
    const p = await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(p.body.availability).toMatchObject({ canBuy: true, reason: null, maxBuy: 3 });

    for (const url of [
      '/api/v1/games/cs2/cargo/no-such-cargo',
      '/api/v1/games/cs2/cargo/Bad_Slug!',
      `/api/v1/games/standoff2/cargo/${c.slug}`,
    ]) {
      const res = await guest.get<Err>(url);
      expect(res.status, url).toBe(404);
      expect(res.body.error.code).toBe('CARGO_NOT_FOUND');
    }
    const noGame = await guest.get<Err>('/api/v1/games/nogame/cargo');
    expect(noGame.status).toBe(404);
    expect(noGame.body.error.code).toBe('GAME_NOT_FOUND');
  });

  it('buys K seats: ledger entry with seats and seeds, next purchase continues numbering', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const { client, me } = await playerWith(1_000);
    const s1 = seed();
    const r1 = await buy(client, c, 2, { seed: s1 });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({
      templateId: c.id,
      slug: c.slug,
      roundId: c.round.id,
      seatFrom: 1,
      seatTo: 2,
      count: 2,
      paid: 200,
      balance: 800,
      clientSeed: s1,
      serverSeedHash: c.round.serverSeedHash,
      result: null,
      next: null,
    });
    expect(r1.body.round).toMatchObject({ id: c.round.id, status: 'open', seatsSold: 2 });
    expect(await userBalance(app, me.id)).toBe(800);
    const [entry] = await db(app)
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.refType, 'cargo_purchase'),
          eq(ledgerEntries.refId, r1.body.purchaseId),
        ),
      );
    expect(entry).toMatchObject({
      userId: me.id,
      type: 'cargo_entry',
      amount: -200,
      idempotencyKey: `cargo:${r1.body.purchaseId}`,
    });
    expect(entry!.meta).toEqual({
      roundId: c.round.id,
      templateId: c.id,
      game: 'cs2',
      seatFrom: 1,
      seatTo: 2,
      count: 2,
      clientSeed: s1,
      serverSeedHash: c.round.serverSeedHash,
    });

    const s2 = seed();
    const r2 = await buy(client, c, 3, { seed: s2 });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ seatFrom: 3, seatTo: 5, paid: 300, balance: 500 });
    const mine = [
      { seatFrom: 1, seatTo: 2, clientSeed: s1 },
      { seatFrom: 3, seatTo: 5, clientSeed: s2 },
    ];
    expect(r2.body.availability).toEqual({
      canBuy: true,
      reason: null,
      mySeats: 5,
      myPurchases: mine,
      maxBuy: 5,
    });
    const d = await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.round?.seatsSold).toBe(5);
    expect(d.body.availability).toMatchObject({ mySeats: 5, myPurchases: mine, maxBuy: 5 });
  });

  it('requires login and 18+', async () => {
    const c = await createCargo();
    const guest = await buy(new TestClient(app), c, 1);
    expect(guest.status).toBe(401);
    const minor = new TestClient(app);
    await minor.devLogin('player', `cm${Math.random().toString(36).slice(2, 10)}`);
    const res = await buy(minor, c, 1);
    expect(res.status).toBe(403);
    expect((res.body as unknown as Err).error.code).toBe('ADULT_CONFIRMATION_REQUIRED');
    const d = await minor.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.availability).toMatchObject({ canBuy: false, reason: 'ADULT', maxBuy: 3 });
  });

  it('insufficient balance rolls back everything (no purchase, no seats, no idempotency key)', async () => {
    const c = await createCargo();
    const { client, me } = await newPlayer(app, 'cpoor');
    const key = crypto.randomUUID();
    const res = await buy(client, c, 1, { key });
    expect(res.status).toBe(402);
    expect((res.body as unknown as Err).error.code).toBe('INSUFFICIENT_BALANCE');
    const rows = await db(app)
      .select()
      .from(cargoPurchases)
      .where(eq(cargoPurchases.roundId, c.round.id));
    expect(rows).toHaveLength(0);
    expect((await roundRow(c.round.id)).seatsSold).toBe(0);
    const keys = await db(app)
      .select()
      .from(idempotencyRequests)
      .where(and(eq(idempotencyRequests.userId, me.id), eq(idempotencyRequests.key, key)));
    expect(keys).toHaveLength(0);
  });

  it('idempotency: same key replays without a second debit; other body → 422', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const { client, me } = await playerWith(1_000);
    const key = crypto.randomUUID();
    const s = seed();
    const a = await buy(client, c, 1, { key, seed: s });
    const b = await buy(client, c, 1, { key, seed: s });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(await userBalance(app, me.id)).toBe(900);
    const rows = await db(app)
      .select()
      .from(cargoPurchases)
      .where(eq(cargoPurchases.roundId, c.round.id));
    expect(rows).toHaveLength(1);
    const reused = await buy(client, c, 2, { key, seed: s });
    expect(reused.status).toBe(422);
    expect((reused.body as unknown as Err).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('no overselling: 6 players race for 3 seats, the round lands, round #2 opens', async () => {
    const c = await createCargo();
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => playerWith(1_000, `cr${i}`)),
    );
    const results = await Promise.all(players.map((p) => buy(p.client, c, 1)));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(['CARGO_SEATS_LEFT', 'CARGO_ROUND_CLOSED']).toContain(
        (r.body as unknown as Err).error.code,
      );
    }
    expect(ok.map((r) => r.body.seatFrom).sort()).toEqual([1, 2, 3]);
    const landedBy = ok.filter((r) => r.body.result);
    expect(landedBy).toHaveLength(1);
    expect(landedBy[0]!.body.result?.status).toBe('landed');
    expect(landedBy[0]!.body.next?.number).toBe(2);

    const round = await roundRow(c.round.id);
    expect(round.status).toBe('landed');
    expect(round.seatsSold).toBe(3);
    const okIds = players.filter((_, i) => results[i]!.status === 200).map((p) => p.me.id);
    expect(okIds).toContain(round.winnerId);
    for (const [i, p] of players.entries()) {
      expect(await userBalance(app, p.me.id)).toBe(results[i]!.status === 200 ? 900 : 1_000);
    }
    expect((await openRoundOf(c.id))?.number).toBe(2);
  });

  it('per-player limit: 409 CARGO_LIMIT_REACHED; parallel purchases of one player respect it', async () => {
    const c = await createCargo({ seatsTotal: 10, perUserLimit: 2 });
    const a = await playerWith(1_000);
    const r1 = await buy(a.client, c, 2);
    expect(r1.status).toBe(200);
    expect(r1.body.availability).toMatchObject({ canBuy: false, reason: 'LIMIT', maxBuy: 0 });
    const r2 = await buy(a.client, c, 1);
    expect(r2.status).toBe(409);
    expect((r2.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_LIMIT_REACHED',
      details: { limit: 2, mine: 2 },
    });

    const b = await playerWith(1_000);
    const results = await Promise.all(Array.from({ length: 4 }, () => buy(b.client, c, 1)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect((r.body as unknown as Err).error.code).toBe('CARGO_LIMIT_REACHED');
    }
    expect(await userBalance(app, b.me.id)).toBe(800);
    const d = await b.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.availability).toMatchObject({ reason: 'LIMIT', mySeats: 2, maxBuy: 0 });
  });

  it('free cargo: deposit condition, no ledger entry, one seat per player; level condition', async () => {
    const c = await createCargo({
      seatsTotal: 10,
      seatPrice: 0,
      perUserLimit: 1,
      depositWithinDays: 30,
    });
    const { client, me } = await newPlayer(app, 'cfree');
    const d0 = await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d0.body.isFree).toBe(true);
    expect(d0.body.availability).toMatchObject({ canBuy: false, reason: 'NO_DEPOSIT', maxBuy: 1 });
    const r0 = await buy(client, c, 1);
    expect(r0.status).toBe(403);
    expect((r0.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_CONDITIONS_NOT_MET',
      details: { reason: 'NO_DEPOSIT', days: 30 },
    });

    await deposit(client, 5);
    const balance = await userBalance(app, me.id);
    const two = await buy(client, c, 2);
    expect(two.status).toBe(409);
    expect((two.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_LIMIT_REACHED',
      details: { limit: 1, mine: 0 },
    });
    const ok = await buy(client, c, 1);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ paid: 0, balance, seatFrom: 1, seatTo: 1 });
    expect(ok.body.availability).toMatchObject({ reason: 'LIMIT', mySeats: 1, maxBuy: 0 });
    expect(await userBalance(app, me.id)).toBe(balance);
    const [purchase] = await db(app)
      .select()
      .from(cargoPurchases)
      .where(eq(cargoPurchases.id, ok.body.purchaseId));
    expect(purchase?.ledgerEntryId).toBeNull();
    const entries = await db(app)
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.refId, ok.body.purchaseId));
    expect(entries).toHaveLength(0);
    const again = await buy(client, c, 1);
    expect(again.status).toBe(409);
    expect((again.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_LIMIT_REACHED',
      details: { limit: 1, mine: 1 },
    });

    const lv = await createCargo({ seatsTotal: 10, minLevel: 50 });
    const p = await playerWith(1_000);
    const res = await buy(p.client, lv, 1);
    expect(res.status).toBe(403);
    expect((res.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_CONDITIONS_NOT_MET',
      details: { reason: 'LEVEL', level: 50 },
    });
    const d = await p.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${lv.slug}`);
    expect(d.body.availability).toMatchObject({ canBuy: false, reason: 'LEVEL', maxBuy: 10 });
  });

  it('sold out → lands in the same request: prize to the winner, feed, notification, XP, round #2', async () => {
    const c = await createCargo();
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    const ra = await buy(a.client, c, 2);
    expect(ra.body.result).toBeNull();
    const last = await buy(b.client, c, 1);
    expect(last.status).toBe(200);
    const result = last.body.result!;
    expect(result).toMatchObject({
      roundId: c.round.id,
      templateId: c.id,
      number: 1,
      status: 'landed',
      landReason: 'sold_out',
      seatsSold: 3,
      seatsTotal: 3,
      refunded: false,
    });
    expect(result.prize.id).toBe(c.prize.id);
    expect(result.winningSeat).toBeGreaterThanOrEqual(1);
    expect(result.winningSeat).toBeLessThanOrEqual(3);
    const winner = result.winningSeat! <= 2 ? a : b;
    expect(result.winner).toMatchObject({
      shortId: winner.me.shortId,
      nickname: winner.me.nickname,
    });
    expect(last.body.round).toMatchObject({ status: 'landed', seatsSold: 3 });
    expect(last.body.availability).toMatchObject({ canBuy: false, reason: 'SOLD_OUT', maxBuy: 0 });
    expect(last.body.next).toMatchObject({
      number: 2,
      status: 'open',
      seatsSold: 0,
      seatPrice: 100,
    });

    const round = await roundRow(c.round.id);
    expect(round.winnerId).toBe(winner.me.id);
    const [ui] = await db(app).select().from(userItems).where(eq(userItems.id, round.userItemId!));
    expect(ui).toMatchObject({
      userId: winner.me.id,
      itemId: c.prize.id,
      sourceType: 'cargo',
      sourceId: c.round.id,
      status: 'in_inventory',
    });
    const inv = await winner.client.get<InventoryPageDto>(
      '/api/v1/games/cs2/inventory?pageSize=100',
    );
    expect(inv.body.items.find((x) => x.id === round.userItemId)?.source).toBe('cargo');

    const drops = (await outbox('drop.created', 'userId', winner.me.id)).filter(
      (e) => (e.payload as { drops: Array<{ id: string }> }).drops[0]?.id === round.userItemId,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]!.payload).toMatchObject({
      game: 'cs2',
      source: 'cargo',
      caseSlug: null,
      caseName: 'Тестовый груз',
      caseImage: '/media/cargo/light-256.webp',
    });
    expect(drops[0]!.availableAt.getTime() - drops[0]!.createdAt.getTime()).toBeGreaterThan(2_000);
    const notes = (await outbox('notification.create', 'userId', winner.me.id)).filter(
      (e) => (e.payload as { type: string }).type === 'cargo_won',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.payload).toMatchObject({
      params: { cargo: 'Тестовый груз', item: c.prize.fullName },
      link: '/cs2/profile',
    });
    const wagers = await outbox('wager.placed', 'sourceId', c.round.id);
    expect(
      wagers.map((w) => w.payload).sort((x, y) => Number(x.amount) - Number(y.amount)),
    ).toEqual([
      { userId: b.me.id, amount: 100, sourceType: 'cargo_round', sourceId: c.round.id },
      { userId: a.me.id, amount: 200, sourceType: 'cargo_round', sourceId: c.round.id },
    ]);

    const d = await a.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.round?.number).toBe(2);
    expect(d.body.lastResult).toMatchObject({ roundId: c.round.id, status: 'landed' });
    expect(d.body.availability.mySeats).toBe(0);
  });

  it('deadline with a partial sale: the only buyer wins; repeated land() is a no-op', async () => {
    const c = await createCargo();
    const p = await playerWith(1_000);
    await buy(p.client, c, 1);
    await endNow(c.round.id);
    const out = (await svc().land(c.round.id)) as CargoLanding;
    expect(out.result).toMatchObject({
      status: 'landed',
      landReason: 'deadline',
      seatsSold: 1,
      winningSeat: 1,
    });
    expect(out.winnerId).toBe(p.me.id);
    expect(out.next?.number).toBe(2);
    expect(await svc().land(c.round.id)).toBeNull();
  });

  it('deadline without sales: expired, no winner, seed revealed, next round, no XP', async () => {
    const c = await createCargo();
    await endNow(c.round.id);
    const out = (await svc().land(c.round.id)) as CargoLanding;
    expect(out.result).toMatchObject({
      status: 'expired',
      landReason: 'deadline',
      seatsSold: 0,
      winningSeat: null,
      winner: null,
      refunded: false,
    });
    expect(out.winnerId).toBeNull();
    expect(out.next?.number).toBe(2);
    const proof = await new TestClient(app).get<CargoProofDto>(
      `/api/v1/fair/proof/cargo/${c.round.id}`,
    );
    expect(proof.body).toMatchObject({ revealed: true, status: 'expired', clientSeed: null });
    expect(verifyServerSeed(proof.body.serverSeed!, proof.body.serverSeedHash)).toBe(true);
    expect(await outbox('wager.placed', 'sourceId', c.round.id)).toHaveLength(0);
  });

  it('early deadline event re-schedules itself for the rest of the timer', async () => {
    const c = await createCargo();
    const early = await svc().land(c.round.id);
    expect(early).toMatchObject({ notDue: true });
    expect((early as { msLeft: number }).msLeft).toBeGreaterThan(59 * 60_000);
    expect(await svc().onDeadline(c.round.id)).toBeNull();
    const evs = await outbox('cargo.deadline', 'roundId', c.round.id);
    expect(evs).toHaveLength(2);
    const round = await roundRow(c.round.id);
    expect(Math.abs(evs[1]!.availableAt.getTime() - round.endsAt.getTime())).toBeLessThan(5_000);
    expect(round.status).toBe('open');
  });

  it('purchase after the deadline (round still open) → 409 deadline, no debit', async () => {
    const c = await createCargo();
    const { client, me } = await playerWith(1_000);
    await endNow(c.round.id);
    const res = await buy(client, c, 1);
    expect(res.status).toBe(409);
    expect((res.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_ROUND_CLOSED',
      details: { reason: 'deadline' },
    });
    expect(await userBalance(app, me.id)).toBe(1_000);
  });

  it('stale or foreign roundId → 409 CARGO_ROUND_CLOSED; unknown slug → 404', async () => {
    const c = await createCargo();
    const other = await createCargo();
    const { client } = await playerWith(1_000);
    const foreign = await buy(client, { slug: c.slug, round: other.round }, 1);
    expect((foreign.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_ROUND_CLOSED',
      details: { reason: 'stale' },
    });
    const random = await buy(client, { slug: c.slug, round: { id: newId() } }, 1);
    expect((random.body as unknown as Err).error.details).toEqual({ reason: 'stale' });
    await endNow(c.round.id);
    await svc().land(c.round.id);
    const old = await buy(client, c, 1);
    expect(old.status).toBe(409);
    expect((old.body as unknown as Err).error).toMatchObject({
      code: 'CARGO_ROUND_CLOSED',
      details: { reason: 'status' },
    });
    const unknown = await buy(client, { slug: 'no-such-cargo', round: other.round }, 1);
    expect(unknown.status).toBe(404);
    expect((unknown.body as unknown as Err).error.code).toBe('CARGO_NOT_FOUND');
  });

  it('template edits apply from the next round (snapshot in the round)', async () => {
    const c = await createCargo();
    await db(app).update(cargoTemplates).set({ seatPrice: 300 }).where(eq(cargoTemplates.id, c.id));
    const { client } = await playerWith(1_000);
    const res = await buy(client, c, 3);
    expect(res.body).toMatchObject({ paid: 300, balance: 700 });
    expect(res.body.result?.status).toBe('landed');
    expect(res.body.next).toMatchObject({ number: 2, seatPrice: 300 });
  });

  it('disabled template plays the current round out, then disappears', async () => {
    const c = await createCargo();
    await db(app)
      .update(cargoTemplates)
      .set({ isActive: false })
      .where(eq(cargoTemplates.id, c.id));
    const guest = new TestClient(app);
    expect((await guest.get(`/api/v1/games/cs2/cargo/${c.slug}`)).status).toBe(200);
    const { client } = await playerWith(1_000);
    const res = await buy(client, c, 3);
    expect(res.status).toBe(200);
    expect(res.body.result?.status).toBe('landed');
    expect(res.body.next).toBeNull();
    const d = await guest.get<Err>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.status).toBe(404);
    expect(d.body.error.code).toBe('CARGO_NOT_FOUND');
    const list = await guest.get<CargoListDto>('/api/v1/games/cs2/cargo');
    expect(list.body.items.find((x) => x.slug === c.slug)).toBeUndefined();
  });

  it('disabled prize: the running round still pays out, no new round until the item is back', async () => {
    const gid = await gameId(app, 'cs2');
    // Свой предмет-приз (не самый дешёвый, общий для остальных тестов).
    const [item] = await db(app)
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.gameId, gid), eq(items.isActive, true)))
      .orderBy(asc(items.price), asc(items.id))
      .offset(7)
      .limit(1);
    const c = await createCargo({ prizeItemId: item!.id });
    try {
      await db(app).update(items).set({ isActive: false }).where(eq(items.id, item!.id));
      const { client } = await playerWith(1_000);
      const res = await buy(client, c, 3);
      expect(res.body.result).toMatchObject({ status: 'landed' });
      expect(res.body.result?.prize.id).toBe(item!.id);
      expect(res.body.next).toBeNull();
      const d = await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
      expect(d.body).toMatchObject({ round: null, noRound: 'PRIZE_UNAVAILABLE' });
      expect(d.body.availability).toMatchObject({ canBuy: false, reason: 'UNAVAILABLE' });
      expect(d.body.lastResult?.status).toBe('landed');
      const skipped = await svc().ensureOpenRounds();
      expect(skipped.map((o) => o.templateId)).not.toContain(c.id);

      await db(app).update(items).set({ isActive: true }).where(eq(items.id, item!.id));
      const opened = await svc().ensureOpenRounds();
      expect(opened.find((o) => o.templateId === c.id)?.round.number).toBe(2);
    } finally {
      await db(app).update(items).set({ isActive: true }).where(eq(items.id, item!.id));
    }
  });

  it('provably fair: commit before, reveal after; the winning seat is reproducible', async () => {
    const c = await createCargo();
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    const ra = await buy(a.client, c, 2);
    const url = `/api/v1/fair/proof/cargo/${c.round.id}`;
    const open = await new TestClient(app).get<CargoProofDto>(url);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({
      type: 'cargo',
      id: c.round.id,
      cargoName: 'Тестовый груз',
      number: 1,
      status: 'open',
      revealed: false,
      serverSeed: null,
      serverSeedHash: ra.body.serverSeedHash,
      clientSeed: null,
      seatsSold: 2,
      winningSeat: null,
      winner: null,
    });
    const rb = await buy(b.client, c, 1);
    expect(rb.body.result?.status).toBe('landed');

    const proof = (await new TestClient(app).get<CargoProofDto>(url)).body;
    expect(proof.revealed).toBe(true);
    expect(verifyServerSeed(proof.serverSeed!, proof.serverSeedHash)).toBe(true);
    expect(proof.purchases.map((p) => [p.seatFrom, p.seatTo])).toEqual([
      [1, 2],
      [3, 3],
    ]);
    expect(cargoClientSeed(proof.purchases)).toBe(proof.clientSeed);
    const seat = cargoWinningSeat(proof.serverSeed!, proof.clientSeed!, proof.seatsSold);
    expect(seat).toBe(proof.winningSeat);
    expect(seat).toBe(rb.body.result?.winningSeat);
    const owner = cargoSeatOwner(proof.purchases, seat);
    const winner = owner.seatFrom === 1 ? a : b;
    expect(proof.winner).toEqual({ shortId: winner.me.shortId, nickname: winner.me.nickname });
    expect(proof.prize).toMatchObject({ itemId: c.prize.id, name: c.prize.fullName });
    const mine = (await winner.client.get<CargoProofDto>(url)).body;
    expect(cargoSeatOwner(mine.purchases, seat).mine).toBe(true);
    expect(mine.purchases.filter((p) => p.mine)).toHaveLength(1);

    const missing = await new TestClient(app).get<Err>(`/api/v1/fair/proof/cargo/${newId()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CARGO_ROUND_NOT_FOUND');
    expect((await new TestClient(app).get('/api/v1/fair/proof/cargo/not-a-uuid')).status).toBe(400);
  });

  it('sweep(): lands the oldest overdue round and opens missing rounds', async () => {
    const a = await createCargo();
    await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() - interval '365 days'` })
      .where(eq(cargoRounds.id, a.round.id));
    const b = await createCargo();
    await db(app)
      .update(cargoRounds)
      .set({ status: 'expired', landReason: 'deadline', finishedAt: sql`now()` })
      .where(eq(cargoRounds.id, b.round.id));
    const s = await svc().sweep();
    const mine = s.landed.find((l) => l.result.roundId === a.round.id);
    expect(mine?.result.status).toBe('expired');
    expect(mine?.next?.number).toBe(2);
    expect((await roundRow(a.round.id)).status).toBe('expired');
    expect(s.opened.find((o) => o.templateId === b.id)?.round.number).toBe(2);
  });

  it('ticker: landed rounds reach the notifier even if opening rounds fails afterwards', async () => {
    const c = await createCargo();
    const p = await playerWith(1_000);
    await buy(p.client, c, 1);
    await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() - interval '365 days'` })
      .where(eq(cargoRounds.id, c.round.id));
    const finished: CargoLanding[] = [];
    const opened: CargoOpened[] = [];
    const notifier = {
      finished: (l: CargoLanding) => finished.push(l),
      opened: (o: CargoOpened) => opened.push(o),
    } as unknown as CargoNotifier;
    const handlers = new CargoHandlers({ on() {} } as unknown as OutboxProcessor, svc(), notifier);
    // Сбой уже после приземлений (первый запрос открытия раундов: БД или пул): приземление закоммичено,
    // повторно его события не отправит никто — ни следующий проход, ни событие cargo.deadline.
    const open = vi.spyOn(svc(), 'ensureOpenRounds').mockRejectedValueOnce(new Error('transient'));
    const log = vi.spyOn(loggerOf(svc()), 'error');
    let logged: string[];
    try {
      await handlers.sweepOnce();
      expect(open).toHaveBeenCalledTimes(1);
      logged = log.mock.calls.map(([m]) => String(m));
    } finally {
      open.mockRestore();
      log.mockRestore();
    }
    expect((await roundRow(c.round.id)).status).toBe('landed');
    const mine = finished.filter((l) => l.result.roundId === c.round.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ winnerId: p.me.id, result: { status: 'landed' } });
    expect(mine[0]!.next?.number).toBe(2);
    expect(opened).toEqual([]);
    expect(logged.some((m) => m.includes('transient'))).toBe(true);
  });

  it('client seed is required and echoed in the proof (mine only for the buyer)', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const { client, me } = await playerWith(1_000);
    for (const body of [
      { roundId: c.round.id, count: 1 },
      { roundId: c.round.id, count: 1, clientSeed: 'short' },
      { roundId: c.round.id, count: 1, clientSeed: 'with spaces and !' },
      { roundId: c.round.id, count: 1, clientSeed: seed(), extra: true },
    ]) {
      const res = await client.post<Err>(buyUrl(c.slug), body, IK());
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await userBalance(app, me.id)).toBe(1_000);
    expect(
      await db(app).select().from(cargoPurchases).where(eq(cargoPurchases.roundId, c.round.id)),
    ).toHaveLength(0);

    const s = seed();
    expect((await buy(client, c, 2, { seed: s })).status).toBe(200);
    const url = `/api/v1/fair/proof/cargo/${c.round.id}`;
    const own = await client.get<CargoProofDto>(url);
    expect(own.body.purchases).toEqual([{ seatFrom: 1, seatTo: 2, clientSeed: s, mine: true }]);
    const guest = await new TestClient(app).get<CargoProofDto>(url);
    expect(guest.body.purchases).toEqual([{ seatFrom: 1, seatTo: 2, clientSeed: s, mine: false }]);
  });

  it('minimum sales (D36): under the minimum → expired with refunds and a public void seat', async () => {
    const c = await createCargo({ seatsTotal: 5, minSeatsToLand: 3 });
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    await buy(a.client, c, 1);
    await buy(b.client, c, 1);
    await endNow(c.round.id);
    const out = (await svc().land(c.round.id)) as CargoLanding;
    expect(out.result).toMatchObject({
      status: 'expired',
      landReason: 'min_seats',
      seatsSold: 2,
      minSeatsToLand: 3,
      winningSeat: null,
      winner: null,
      refunded: true,
    });
    expect(out.winnerId).toBeNull();
    expect(out.balances).toHaveLength(2);
    expect(out.balances).toEqual(
      expect.arrayContaining([
        { userId: a.me.id, balance: 1_000 },
        { userId: b.me.id, balance: 1_000 },
      ]),
    );
    expect(await userBalance(app, a.me.id)).toBe(1_000);
    expect(await userBalance(app, b.me.id)).toBe(1_000);
    const refunds = await db(app)
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.type, 'cargo_refund'), eq(ledgerEntries.refId, c.round.id)));
    expect(refunds.map((e) => e.idempotencyKey).sort()).toEqual(
      [a.me.id, b.me.id].map((u) => `cargo_refund:${c.round.id}:${u}`).sort(),
    );
    for (const e of refunds) expect(e).toMatchObject({ amount: 100, refType: 'cargo_round' });
    const purchases = await db(app)
      .select()
      .from(cargoPurchases)
      .where(eq(cargoPurchases.roundId, c.round.id))
      .orderBy(asc(cargoPurchases.seatFrom));
    for (const p of purchases) expect(p.refundedAt).not.toBeNull();
    for (const u of [a, b]) {
      const notes = (await outbox('notification.create', 'userId', u.me.id)).filter(
        (e) => (e.payload as { type: string }).type === 'cargo_refund',
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]!.payload).toMatchObject({
        params: { gems: 100, cargo: 'Тестовый груз', why: 'min_seats' },
        link: `/provably-fair?cargo=${c.round.id}`,
      });
    }
    expect(await outbox('wager.placed', 'sourceId', c.round.id)).toHaveLength(0);
    const round = await roundRow(c.round.id);
    expect(round.clientSeed).toBe(cargoClientSeed(purchases));
    const proof = (
      await new TestClient(app).get<CargoProofDto>(`/api/v1/fair/proof/cargo/${c.round.id}`)
    ).body;
    expect(proof).toMatchObject({
      revealed: true,
      landReason: 'min_seats',
      voidSeat: round.voidSeat,
    });
    expect(cargoWinningSeat(proof.serverSeed!, round.clientSeed!, 2)).toBe(round.voidSeat);
    expect(out.next?.number).toBe(2);
    expect(await app.get(LedgerService).reconcile()).toEqual([]);
    expect(await reconcileCargo(db(app))).toEqual([]);
    expect(await svc().land(c.round.id)).toBeNull();

    // Тот же шаблон: минимум набран — обычное приземление с победителем.
    const r2 = { slug: c.slug, round: { id: out.next!.id } };
    await buy(a.client, r2, 2);
    await buy(b.client, r2, 1);
    await endNow(r2.round.id);
    const landed = (await svc().land(r2.round.id)) as CargoLanding;
    expect(landed.result).toMatchObject({ status: 'landed', landReason: 'deadline', seatsSold: 3 });
    expect([a.me.id, b.me.id]).toContain(landed.winnerId);

    // Бесплатный груз с минимумом: возвращать нечего, ledger не трогается.
    const f = await createCargo({
      seatsTotal: 5,
      minSeatsToLand: 3,
      seatPrice: 0,
      perUserLimit: 1,
    });
    await buy(a.client, f, 1);
    await endNow(f.round.id);
    const free = (await svc().land(f.round.id)) as CargoLanding;
    expect(free.result).toMatchObject({
      status: 'expired',
      landReason: 'min_seats',
      refunded: false,
    });
    expect(free.balances).toEqual([]);
    expect(
      await db(app)
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.type, 'cargo_refund'), eq(ledgerEntries.refId, f.round.id))),
    ).toHaveLength(0);
  });

  it('refund by a round id in upper case: ledger, audit and reconciliation get the canonical id (D39)', async () => {
    // UUID прописными проходит z.string().uuid() (будущая ручка отмены), а uuid в PostgreSQL сравнивается без учёта
    // регистра — раунд найдётся. Но ref_id и ключ возврата — текст, сверка сравнивает их с round_id::text.
    const c = await createCargo({ seatsTotal: 5 });
    const p = await playerWith(1_000);
    const admin = await newPlayer(app, 'cadm');
    await buy(p.client, c, 2);
    const id = c.round.id;
    const cancel = (roundId: string) =>
      svc().closeWithRefund(roundId, {
        status: 'cancelled',
        actorId: admin.me.id,
        reason: 'test cancel',
        ip: null,
      });
    const out = await cancel(id.toUpperCase());
    expect(out?.result).toMatchObject({ roundId: id, status: 'cancelled', refunded: true });
    expect(out?.balances).toEqual([{ userId: p.me.id, balance: 1_000 }]);
    const refundsOf = (userId: string) =>
      db(app)
        .select({
          refId: ledgerEntries.refId,
          key: ledgerEntries.idempotencyKey,
          amount: ledgerEntries.amount,
        })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.type, 'cargo_refund'), eq(ledgerEntries.userId, userId)));
    expect(await refundsOf(p.me.id)).toEqual([
      { refId: id, key: `cargo_refund:${id}:${p.me.id}`, amount: 200 },
    ]);
    const audit = await db(app)
      .select({ entityId: adminAuditLog.entityId })
      .from(adminAuditLog)
      .where(
        and(eq(adminAuditLog.action, 'cargo_round.cancel'), eq(adminAuditLog.actorId, admin.me.id)),
      );
    expect(audit).toEqual([{ entityId: id }]);
    expect(await reconcileCargo(db(app))).toEqual([]);
    await expect(cancel(id)).rejects.toMatchObject({ code: 'CARGO_ROUND_NOT_OPEN' });
    expect(await refundsOf(p.me.id)).toHaveLength(1);
    expect(await userBalance(app, p.me.id)).toBe(1_000);

    // Минимум продаж (D36) через land() с id прописными — тот же путь возврата.
    const m = await createCargo({ seatsTotal: 5, minSeatsToLand: 3 });
    const q = await playerWith(1_000);
    await buy(q.client, m, 1);
    await endNow(m.round.id);
    const expired = (await svc().land(m.round.id.toUpperCase())) as CargoLanding;
    expect(expired.result).toMatchObject({
      roundId: m.round.id,
      status: 'expired',
      landReason: 'min_seats',
      refunded: true,
    });
    expect(await refundsOf(q.me.id)).toEqual([
      { refId: m.round.id, key: `cargo_refund:${m.round.id}:${q.me.id}`, amount: 100 },
    ]);
    expect(await reconcileCargo(db(app))).toEqual([]);
  });

  it('landing failure on the last seat (D2): purchase kept, round sold out, worker lands later', async () => {
    const c = await createCargo();
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    await buy(a.client, c, 2);
    const spy = vi
      .spyOn(app.get(InventoryService), 'grant')
      .mockRejectedValueOnce(new Error('boom'));
    let last: Awaited<ReturnType<typeof buy>>;
    try {
      last = await buy(b.client, c, 1);
    } finally {
      spy.mockRestore();
    }
    expect(last.status).toBe(200);
    expect(last.body).toMatchObject({ paid: 100, balance: 900, result: null, next: null });
    expect(last.body.round).toMatchObject({ status: 'open', seatsSold: 3 });
    expect(last.body.availability).toMatchObject({ canBuy: false, reason: 'SOLD_OUT', maxBuy: 0 });
    const [entry] = await db(app)
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.refId, last.body.purchaseId));
    expect(entry).toMatchObject({ type: 'cargo_entry', amount: -100, userId: b.me.id });
    const round = await roundRow(c.round.id);
    expect(round).toMatchObject({
      status: 'open',
      seatsSold: 3,
      landAttempts: 1,
      lastLandError: 'boom',
    });
    expect(round.lastLandErrorAt).not.toBeNull();
    const d = await b.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.availability).toMatchObject({
      canBuy: false,
      reason: 'SOLD_OUT',
      mySeats: 1,
      myPurchases: [{ seatFrom: 3, seatTo: 3, clientSeed: last.body.clientSeed }],
    });
    const due = (await outbox('cargo.deadline', 'roundId', c.round.id)).filter(
      (e) => e.availableAt.getTime() <= Date.now() && !e.processedAt,
    );
    expect(due).toHaveLength(1);
    const out = (await svc().land(c.round.id)) as CargoLanding;
    expect(out.result).toMatchObject({ status: 'landed', landReason: 'sold_out', seatsSold: 3 });
    expect(await reconcileCargo(db(app))).toEqual([]);
  });

  it('landing failure with a real DB error: the cause is kept, not the SQL with players and outcome', async () => {
    const c = await createCargo();
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    const buyers = [a.me.id, b.me.id];
    await buy(a.client, c, 2);
    const grant = failPrizeGrant(app.get(InventoryService), c.round.id);
    const log = vi.spyOn(loggerOf(svc()), 'error');
    const logged = () =>
      log.mock.calls.map(([m]) => String(m)).filter((m) => m.includes(c.round.id));
    try {
      // D2: последнее место — приземление в SAVEPOINT падает, покупка остаётся.
      const last = await buy(b.client, c, 1);
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ result: null, round: { status: 'open', seatsSold: 3 } });
      const stuck = await roundRow(c.round.id);
      expect(stuck.landAttempts).toBe(1);
      expectCauseOnly(stuck.lastLandError, buyers);
      expect(logged()).toHaveLength(1);
      expectCauseOnly(logged()[0], buyers);

      // Воркер: land() падает так же — причина в last_land_error, ошибка уходит наружу (повтор outbox).
      await expect(svc().land(c.round.id)).rejects.toThrow();
      const again = await roundRow(c.round.id);
      expect(again.landAttempts).toBe(2);
      expectCauseOnly(again.lastLandError, buyers);

      // Тикер (окно 5 мин после ошибки прошло): в логе прохода — причина.
      await db(app)
        .update(cargoRounds)
        .set({
          lastLandErrorAt: sql`now() - interval '6 minutes'`,
          endsAt: sql`now() - interval '365 days'`,
        })
        .where(eq(cargoRounds.id, c.round.id));
      log.mockClear();
      await svc().sweep();
      expect(logged()).toHaveLength(1);
      expectCauseOnly(logged()[0], buyers);
    } finally {
      grant.mockRestore();
      log.mockRestore();
    }
    const out = (await svc().land(c.round.id)) as CargoLanding;
    expect(out.result).toMatchObject({ status: 'landed', landReason: 'sold_out', seatsSold: 3 });
    expect(buyers).toContain(out.winnerId);
    expect(await reconcileCargo(db(app))).toEqual([]);
  });

  it('purchases racing the deadline: only seats committed before landing take part', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => playerWith(1_000, `cd${i}`)),
    );
    await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() + interval '300 milliseconds'` })
      .where(eq(cargoRounds.id, c.round.id));
    const buys = Promise.all(players.map((p, i) => sleep(i * 80).then(() => buy(p.client, c, 1))));
    const landing = (async () => {
      for (let i = 0; i < 200; i++) {
        const out = await svc().land(c.round.id);
        if (out === null || !('notDue' in out)) return out;
        await sleep(20);
      }
      throw new Error('round did not land');
    })();
    const [results, out] = await Promise.all([buys, landing]);
    const round = await roundRow(c.round.id);
    expect(round.status).toBe('landed');
    expect(out?.result.seatsSold).toBe(round.seatsSold);
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length).toBe(round.seatsSold);
    for (const r of ok) expect(r.body.seatTo).toBeLessThanOrEqual(round.seatsSold);
    for (const [i, r] of results.entries()) {
      if (r.status === 200) continue;
      expect(r.status).toBe(409);
      expect((r.body as unknown as Err).error.code).toBe('CARGO_ROUND_CLOSED');
      expect(await userBalance(app, players[i]!.me.id)).toBe(1_000);
    }
    const okIds = players.filter((_, i) => results[i]!.status === 200).map((p) => p.me.id);
    expect(okIds).toContain(round.winnerId);
    expect(await reconcileCargo(db(app))).toEqual([]);
  });

  it('XP (D12): one wager.placed per paying player of a landed round, with the round total', async () => {
    const c = await createCargo({ seatsTotal: 4 });
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    await buy(a.client, c, 1);
    await buy(b.client, c, 1);
    const last = await buy(a.client, c, 2);
    expect(last.body.result?.status).toBe('landed');
    const wagers = await outbox('wager.placed', 'sourceId', c.round.id);
    expect(wagers).toHaveLength(2);
    const byUser = new Map(wagers.map((w) => [w.payload.userId, w.payload.amount]));
    expect(byUser.get(a.me.id)).toBe(300);
    expect(byUser.get(b.me.id)).toBe(100);
  });

  it('closed phase (deadline passed, not landed yet): CLOSED with own seats', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const { client } = await playerWith(1_000);
    const s = seed();
    await buy(client, c, 2, { seed: s });
    await endNow(c.round.id);
    const d = await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(d.body.round).toMatchObject({ id: c.round.id, status: 'open' });
    expect(d.body.availability).toEqual({
      canBuy: false,
      reason: 'CLOSED',
      mySeats: 2,
      myPurchases: [{ seatFrom: 1, seatTo: 2, clientSeed: s }],
      maxBuy: 0,
    });
    const g = await new TestClient(app).get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(g.body.availability).toMatchObject({ reason: 'CLOSED', mySeats: 0, maxBuy: 0 });
  });

  it('seats and money are tied by the database and checked by reconcileCargo (D11, D39)', async () => {
    const landedCargo = await createCargo();
    const { client, me } = await playerWith(1_000);
    const res = await buy(client, landedCargo, 3);
    expect(res.body.result?.status).toBe('landed');
    const roundId = landedCargo.round.id;
    const openCargo = await createCargo();

    let err: unknown = null;
    try {
      await db(app).insert(cargoPurchases).values({
        id: newId(),
        roundId: openCargo.round.id,
        userId: me.id,
        seatFrom: 1,
        seatTo: 1,
        count: 1,
        paid: 100,
        clientSeed: seed(),
        ledgerEntryId: null,
      });
    } catch (e) {
      err = e;
    }
    expect(constraintOf(err)).toBe('cargo_purchases_ledger');

    let refundedAt: CargoMismatchDto[] = [];
    let refundSum: CargoMismatchDto[] = [];
    await expect(
      db(app).transaction(async (tx) => {
        await tx
          .update(cargoPurchases)
          .set({ refundedAt: sql`now()` })
          .where(eq(cargoPurchases.roundId, roundId));
        refundedAt = await reconcileCargo(tx);
        await tx
          .update(cargoPurchases)
          .set({ refundedAt: null })
          .where(eq(cargoPurchases.roundId, roundId));
        // Удалить запись возврата нельзя (ledger только на добавление) — вместо этого «отмена» без возвратов.
        await tx
          .update(cargoRounds)
          .set({ status: 'cancelled' })
          .where(eq(cargoRounds.id, roundId));
        refundSum = await reconcileCargo(tx);
        tx.rollback();
      }),
    ).rejects.toThrow();
    expect(refundedAt).toContainEqual(expect.objectContaining({ check: 'refunded_at', roundId }));
    expect(refundSum).toContainEqual(
      expect.objectContaining({ check: 'refund_sum', roundId, userId: me.id }),
    );
    expect((await roundRow(roundId)).status).toBe('landed');
    const [p] = await db(app)
      .select()
      .from(cargoPurchases)
      .where(and(eq(cargoPurchases.roundId, roundId), isNull(cargoPurchases.refundedAt)));
    expect(p).toBeDefined();
  });

  it('reconcileCargo catches paid ≠ seat price × seats: underpaid seats and free seats in a paid round (check price)', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const a = await playerWith(1_000);
    expect((await buy(a.client, c, 2)).body).toMatchObject({ paid: 200, seatFrom: 1, seatTo: 2 });
    expect(await reconcileCargo(db(app))).toEqual([]);
    const b = await playerWith(1_000);
    const ledger = app.get(LedgerService);
    // Порча — в транзакции с откатом: места 3–4 игрока B оплачены `paid` вместо 2 × 100. Ledger только на
    // добавление, поэтому несогласованность — со стороны покупки; запись ledger (если paid > 0) с ней согласована.
    const probe = async (paid: number) => {
      const purchaseId = newId();
      let found: CargoMismatchDto[] = [];
      await expect(
        db(app).transaction(async (tx) => {
          let ledgerEntryId: number | null = null;
          if (paid > 0) {
            const e = await ledger.post(tx, {
              userId: b.me.id,
              type: 'cargo_entry',
              amount: -paid,
              refType: 'cargo_purchase',
              refId: purchaseId,
              idempotencyKey: `cargo:${purchaseId}`,
              meta: { roundId: c.round.id },
            });
            ledgerEntryId = e.entryId;
          }
          await tx.insert(cargoPurchases).values({
            id: purchaseId,
            roundId: c.round.id,
            userId: b.me.id,
            seatFrom: 3,
            seatTo: 4,
            count: 2,
            paid,
            clientSeed: seed(),
            ledgerEntryId,
          });
          await tx.update(cargoRounds).set({ seatsSold: 4 }).where(eq(cargoRounds.id, c.round.id));
          found = await reconcileCargo(tx);
          tx.rollback();
        }),
      ).rejects.toThrow();
      return { found, purchaseId };
    };
    // (а) Недоплата: 2 места по 100 оплачены 100 — покупка и её запись ledger на −100 согласованы.
    const under = await probe(100);
    expect(under.found).toEqual([
      { check: 'price', roundId: c.round.id, userId: b.me.id, ref: under.purchaseId },
    ]);
    // (б) Бесплатные места в платном раунде: paid 0 без ledger — CHECK (paid = 0) = (ledger IS NULL) это пропускает.
    const free = await probe(0);
    expect(free.found).toEqual([
      { check: 'price', roundId: c.round.id, userId: b.me.id, ref: free.purchaseId },
    ]);
    // Откат: всё как было, сверки чистые.
    expect((await roundRow(c.round.id)).seatsSold).toBe(2);
    expect(await reconcileCargo(db(app))).toEqual([]);
    expect(await ledger.reconcile()).toEqual([]);
  });

  it('lastResultMySeats: seats of the viewer in the last finished round (guest and others — 0)', async () => {
    const c = await createCargo();
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    const other = await playerWith(0);
    const detail = async (client: TestClient) =>
      (await client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`)).body;
    expect(await detail(a.client)).toMatchObject({ lastResult: null, lastResultMySeats: 0 });
    await buy(a.client, c, 2);
    // Места идущего раунда — в availability, не здесь.
    expect(await detail(a.client)).toMatchObject({
      lastResult: null,
      lastResultMySeats: 0,
      availability: { mySeats: 2 },
    });
    const last = await buy(b.client, c, 1);
    expect(last.body.result?.status).toBe('landed');
    // Места, купленные где угодно (другая вкладка — тот же игрок), видны в детальной после приземления.
    for (const [client, seats] of [
      [a.client, 2],
      [b.client, 1],
      [other.client, 0],
      [new TestClient(app), 0],
    ] as const) {
      const d = await detail(client);
      expect(d.lastResult?.roundId).toBe(c.round.id);
      expect(d.lastResultMySeats).toBe(seats);
    }
    // Следующий раунд закрылся без продаж — теперь последний он, мест в нём нет ни у кого.
    const next = (await openRoundOf(c.id))!;
    await endNow(next.id);
    await svc().land(next.id);
    const d = await detail(a.client);
    expect(d.lastResult).toMatchObject({ roundId: next.id, status: 'expired' });
    expect(d.lastResultMySeats).toBe(0);
  });

  it('reconciliation is clean at the end (ledger and cargo)', async () => {
    expect(await app.get(LedgerService).reconcile()).toEqual([]);
    expect(await reconcileCargo(db(app))).toEqual([]);
    expect(await svc().reconcile()).toEqual([]);
  });
});
