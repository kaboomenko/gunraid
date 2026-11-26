import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  adminAuditLog,
  cargoPurchases,
  cargoRounds,
  cargoTemplates,
  items,
  ledgerEntries,
  newId,
  outboxEvents,
} from '@gunraid/db';
import { cargoClientSeed, cargoWinningSeat, verifyServerSeed } from '@gunraid/game-core';
import type {
  AdminCargoBody,
  AdminCargoDetailDto,
  AdminCargoReconciliationDto,
  AdminCargoRoundDetailDto,
  AdminCargoRoundRowDto,
  AdminCargoRowDto,
  AdminDashboardDto,
  AdminPageDto,
  CargoBuyResultDto,
  CargoDetailDto,
  CargoProofDto,
  MeDto,
} from '@gunraid/shared';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestClient, createTestApp, type TestResponse } from '../../test/app.js';
import { db, gameId, grantGems, newPlayer, userBalance } from '../../test/fixtures.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AdminCargoService } from './admin-cargo.service.js';
import { reconcileCargo } from './cargo-recon.js';
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService, type CargoLanding } from './cargo.service.js';

let app: NestFastifyApplication;
let admin: TestClient;
let adminId: string;
type Err = { error: { code: string; details?: Record<string, unknown> } };
type Item = { id: string; price: number };
const A = '/api/v1/admin';
const svc = () => app.get(CargoService);
const seed = () => randomBytes(16).toString('hex'); // client seed покупки обязателен (D5)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Активные предметы cs2 от 100 гемов (RTP «сейчас» при цене места 10 — больше 1) и предмет другой игры. */
let prizes: Item[];
let foreignItem: Item;

beforeAll(async () => {
  app = await createTestApp();
  admin = new TestClient(app);
  await admin.devLogin('admin');
  adminId = (await admin.get<MeDto>('/api/v1/me')).body.id;
  const cs2 = await gameId(app, 'cs2');
  prizes = await db(app)
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(eq(items.gameId, cs2), eq(items.isActive, true), gte(items.price, 100)))
    .orderBy(asc(items.price), asc(items.id))
    .limit(12);
  expect(prizes).toHaveLength(12);
  const so2 = await gameId(app, 'standoff2');
  const [so2Item] = await db(app)
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(eq(items.gameId, so2), eq(items.isActive, true)))
    .orderBy(asc(items.price), asc(items.id))
    .limit(1);
  foreignItem = so2Item!;
});

let n = 0;
const slugOf = () => `ta-${Date.now().toString(36)}-${(n++).toString(36)}`;

function cargoBody(over: Partial<AdminCargoBody> = {}): AdminCargoBody {
  return {
    slug: slugOf(),
    name: 'Груз админки',
    imageUrl: '/media/cargo/black.webp',
    prizeItemId: prizes[0]!.id,
    seatsTotal: 3,
    seatPrice: 100,
    perUserLimit: null,
    durationMinutes: 60,
    minLevel: null,
    depositWithinDays: null,
    minSeatsToLand: null,
    isActive: true,
    sortOrder: 100_000,
    ...over,
  };
}

// Тестовая БД общая между запусками: каждый тест создаёт свои грузы, afterAll убирает их в архив.
const created: string[] = [];
async function createCargo(over: Partial<AdminCargoBody> = {}, game = 'cs2') {
  const res = await admin.post<AdminCargoDetailDto>(`${A}/games/${game}/cargo`, cargoBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  created.push(res.body.id);
  return res.body;
}

/** Правка тем же телом, что у createCargo, с изменениями (slug — тот же). */
const edit = (c: AdminCargoDetailDto, over: Partial<AdminCargoBody>) =>
  admin.put<AdminCargoDetailDto>(
    `${A}/games/${c.game}/cargo/${c.id}`,
    cargoBody({
      slug: c.slug,
      prizeItemId: c.prize.id,
      seatsTotal: c.seatsTotal,
      seatPrice: c.seatPrice,
      ...over,
    }),
  );

const cancel = (roundId: string, reason = 'Отмена раунда в тесте') =>
  admin.post<AdminCargoRoundDetailDto>(`${A}/cargo-rounds/${roundId}/cancel`, { reason });

const buy = (client: TestClient, slug: string, roundId: string, count: number) =>
  client.post<CargoBuyResultDto>(
    `/api/v1/games/cs2/cargo/${slug}/buy`,
    { roundId, count, clientSeed: seed() },
    { 'idempotency-key': crypto.randomUUID() },
  );

async function playerWith(gems: number, prefix = 'ca') {
  const p = await newPlayer(app, prefix);
  if (gems > 0) await grantGems(app, p.me.id, gems);
  return p;
}

async function roundRow(id: string) {
  const [r] = await db(app).select().from(cargoRounds).where(eq(cargoRounds.id, id));
  return r!;
}

async function openRoundOf(templateId: string) {
  const [r] = await db(app)
    .select()
    .from(cargoRounds)
    .where(and(eq(cargoRounds.templateId, templateId), eq(cargoRounds.status, 'open')));
  return r ?? null;
}

/** Срок раунда — в прошлом на interval (по часам БД). */
async function endAgo(roundId: string, interval: string) {
  await db(app)
    .update(cargoRounds)
    .set({ endsAt: sql`now() - ${interval}::interval` })
    .where(eq(cargoRounds.id, roundId));
}

const auditOf = (action: string, entityId: string) =>
  db(app)
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.action, action), eq(adminAuditLog.entityId, entityId)))
    .orderBy(asc(adminAuditLog.id));

const refundsOf = (roundId: string) =>
  db(app)
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.type, 'cargo_refund'), eq(ledgerEntries.refId, roundId)));

async function outbox(type: string, key: string, value: string) {
  return db(app)
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.type, type), sql`${outboxEvents.payload}->>${key} = ${value}`))
    .orderBy(asc(outboxEvents.id));
}

const setItemActive = (id: string, isActive: boolean) =>
  db(app).update(items).set({ isActive }).where(eq(items.id, id));

// Уборка — архивом (D37): выключить (иначе отмена откроет следующий раунд и архив ответит 409), отменить открытый
// раунд с возвратом, убрать в архив. Ошибка одного груза не мешает убрать остальные.
afterAll(async () => {
  const errors: unknown[] = [];
  for (const id of created) {
    try {
      await db(app)
        .update(cargoTemplates)
        .set({ isActive: false })
        .where(and(eq(cargoTemplates.id, id), sql`${cargoTemplates.archivedAt} is null`));
      const open = await openRoundOf(id);
      if (open) await svc().cancelRound(open.id, adminId, 'test cleanup', null);
      await app.get(AdminCargoService).archive(adminId, id, null);
    } catch (e) {
      errors.push(e);
    }
  }
  await app.close();
  if (errors.length) throw errors[0];
});

describe('cargo admin (integration)', () => {
  it('admin only: support and players get 403 on every handle, guests 401, nothing changes', async () => {
    const c = await createCargo();
    const roundId = c.round!.id;
    const support = new TestClient(app);
    await support.devLogin('support');
    const { client: player } = await newPlayer(app, 'cap');
    const sneaky = cargoBody();
    const calls: Array<['GET' | 'POST' | 'PUT' | 'DELETE', string, unknown?]> = [
      ['GET', `${A}/games/cs2/cargo`],
      ['POST', `${A}/games/cs2/cargo`, sneaky],
      ['GET', `${A}/cargo/${c.id}`],
      ['PUT', `${A}/games/cs2/cargo/${c.id}`, cargoBody({ slug: c.slug, isActive: false })],
      ['DELETE', `${A}/cargo/${c.id}`],
      ['GET', `${A}/cargo/${c.id}/rounds`],
      ['GET', `${A}/cargo-rounds/${roundId}`],
      ['POST', `${A}/cargo-rounds/${roundId}/cancel`, { reason: 'Попытка без прав' }],
      ['GET', `${A}/cargo-reconciliation`],
    ];
    const who: Array<[string, TestClient, number]> = [
      ['support', support, 403],
      ['player', player, 403],
      ['guest', new TestClient(app), 401],
    ];
    for (const [name, client, status] of who) {
      for (const [method, url, payload] of calls) {
        const res = await client.request<Err>(method, url, payload);
        expect(res.status, `${name} ${method} ${url}`).toBe(status);
      }
    }
    const after = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
    expect(after).toMatchObject({
      isActive: true,
      archivedAt: null,
      round: { id: roundId, status: 'open' },
    });
    const sneaked = await db(app)
      .select()
      .from(cargoTemplates)
      .where(eq(cargoTemplates.slug, sneaky.slug));
    expect(sneaked).toHaveLength(0);
  });

  it('validates the prize, the slug, the limit and the minimum; free cargo is saved with limit 1', async () => {
    const post = (body: unknown, game = 'cs2') => admin.post<Err>(`${A}/games/${game}/cargo`, body);
    const other = await post(cargoBody({ prizeItemId: foreignItem.id }));
    expect(other.status).toBe(400);
    expect(other.body.error).toMatchObject({
      code: 'CARGO_PRIZE_INVALID',
      details: { reason: 'game' },
    });
    const missing = await post(cargoBody({ prizeItemId: newId() }));
    expect(missing.body.error).toMatchObject({
      code: 'CARGO_PRIZE_INVALID',
      details: { reason: 'missing' },
    });
    const off = prizes[5]!;
    await setItemActive(off.id, false);
    try {
      const inactive = await post(cargoBody({ prizeItemId: off.id }));
      expect(inactive.status).toBe(400);
      expect(inactive.body.error).toMatchObject({
        code: 'CARGO_PRIZE_INVALID',
        details: { reason: 'inactive' },
      });
    } finally {
      await setItemActive(off.id, true);
    }

    const c = await createCargo();
    const dup = await post(cargoBody({ slug: c.slug }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'slug' } });
    // slug уникален в игре: в другой игре тот же адрес свободен.
    const so2 = await createCargo({ slug: c.slug, prizeItemId: foreignItem.id }, 'standoff2');
    expect(so2).toMatchObject({ game: 'standoff2', slug: c.slug });

    const free = await createCargo({ seatPrice: 0, perUserLimit: 5 });
    expect(free).toMatchObject({ seatPrice: 0, perUserLimit: 1, rtp: null });
    expect((await roundRow(free.round!.id)).perUserLimit).toBe(1);

    const limitBody = cargoBody({ seatsTotal: 3, perUserLimit: 4 });
    const limit = await post(limitBody);
    expect(limit.status).toBe(400);
    expect(limit.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'perUserLimit' },
    });
    const min = await post(cargoBody({ seatsTotal: 3, minSeatsToLand: 4 }));
    expect(min.status).toBe(400);
    expect(min.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'minSeatsToLand' },
    });
    // Отказ откатывает всё: шаблона с этим slug нет.
    const rolledBack = await db(app)
      .select()
      .from(cargoTemplates)
      .where(eq(cargoTemplates.slug, limitBody.slug));
    expect(rolledBack).toHaveLength(0);
    // Схема строгая; цена и места — в своих пределах.
    for (const body of [
      { ...cargoBody(), extra: true },
      cargoBody({ seatsTotal: 1 }),
      cargoBody({ seatsTotal: 10_001 }),
      cargoBody({ durationMinutes: 4 }),
      cargoBody({ slug: 'Bad_Slug' }),
      cargoBody({ name: ' ' }),
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    // Шаблон другой игры по адресу правки → 404.
    const foreign = await admin.put<Err>(
      `${A}/games/standoff2/cargo/${c.id}`,
      cargoBody({ slug: c.slug }),
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('CARGO_NOT_FOUND');
    const unknown = await admin.get<Err>(`${A}/cargo/${newId()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('CARGO_NOT_FOUND');
    expect((await admin.get(`${A}/cargo/not-a-uuid`)).status).toBe(400);
  });

  it('creating an active cargo opens round #1 with a snapshot (cargo:round); audit cargo.create', async () => {
    const prize = prizes[1]!;
    const opened = vi.spyOn(app.get(CargoNotifier), 'opened');
    let c: AdminCargoDetailDto;
    try {
      c = await createCargo({
        prizeItemId: prize.id,
        seatsTotal: 7,
        seatPrice: 25,
        perUserLimit: 3,
        durationMinutes: 90,
        minLevel: 2,
        depositWithinDays: 7,
        minSeatsToLand: 4,
      });
      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened.mock.calls[0]![0]).toMatchObject({
        game: 'cs2',
        templateId: c.id,
        slug: c.slug,
        round: { id: c.round!.id, number: 1, status: 'open', seatsTotal: 7, minSeatsToLand: 4 },
      });
    } finally {
      opened.mockRestore();
    }
    expect(c).toMatchObject({
      game: 'cs2',
      name: 'Груз админки',
      imageUrl: '/media/cargo/black.webp',
      isActive: true,
      seatsTotal: 7,
      seatPrice: 25,
      perUserLimit: 3,
      durationMinutes: 90,
      minLevel: 2,
      depositWithinDays: 7,
      minSeatsToLand: 4,
      roundsLanded: 0,
      issue: null,
      archivedAt: null,
    });
    expect(c.prize.id).toBe(prize.id);
    expect(c.rtp).toBeCloseTo(prize.price / (25 * 7), 10);
    expect(c.round).toMatchObject({
      number: 1,
      status: 'open',
      seatsSold: 0,
      seatsTotal: 7,
      seatPrice: 25,
      revenue: 0,
      participants: 0,
      prizeValue: prize.price,
      rtpNow: null,
      minSeatsToLand: 4,
      landAttempts: 0,
      lastLandError: null,
      lastLandErrorAt: null,
    });
    expect(c.round!.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    const r = await roundRow(c.round!.id);
    expect(r).toMatchObject({
      templateId: c.id,
      number: 1,
      status: 'open',
      prizeItemId: prize.id,
      prizeValue: prize.price,
      seatsTotal: 7,
      seatPrice: 25,
      perUserLimit: 3,
      minLevel: 2,
      depositWithinDays: 7,
      minSeatsToLand: 4,
    });
    expect(r.endsAt.getTime() - r.startedAt.getTime()).toBe(90 * 60_000);
    expect(await outbox('cargo.deadline', 'roundId', r.id)).toHaveLength(1);
    const pub = await new TestClient(app).get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(pub.body.round).toMatchObject({ id: r.id, minSeatsToLand: 4, perUserLimit: 3 });

    const audit = await auditOf('cargo.create', c.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entityType: 'cargo',
      after: {
        slug: c.slug,
        name: 'Груз админки',
        prizeItemId: prize.id,
        seatsTotal: 7,
        seatPrice: 25,
        minSeatsToLand: 4,
        isActive: true,
        game: 'cs2',
        roundId: r.id,
      },
    });
    expect(audit[0]!.ip).not.toBeNull();

    // Выключенный груз создаётся без раунда.
    const off = await createCargo({ isActive: false });
    expect(off).toMatchObject({ isActive: false, round: null, issue: null });
    expect(await openRoundOf(off.id)).toBeNull();
  });

  it('edits during a round apply from the next round (new prize in next); audit cargo.update before/after', async () => {
    const [a, b] = [prizes[2]!, prizes[3]!];
    const c = await createCargo({ prizeItemId: a.id, seatsTotal: 3, seatPrice: 100 });
    const p = await playerWith(1_000);
    expect((await buy(p.client, c.slug, c.round!.id, 1)).status).toBe(200);
    const res = await edit(c, {
      prizeItemId: b.id,
      seatsTotal: 5,
      seatPrice: 300,
      name: 'Груз после правки',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ name: 'Груз после правки', seatsTotal: 5, seatPrice: 300 });
    expect(res.body.prize.id).toBe(b.id);
    // Идущий раунд — по своему снимку (D18).
    expect(res.body.round).toMatchObject({
      id: c.round!.id,
      seatsTotal: 3,
      seatPrice: 100,
      seatsSold: 1,
      revenue: 100,
      participants: 1,
      prizeValue: a.price,
    });
    expect(res.body.round!.prize.id).toBe(a.id);
    expect(res.body.round!.rtpNow).toBeCloseTo(a.price / 100, 10);
    expect(await roundRow(c.round!.id)).toMatchObject({
      prizeItemId: a.id,
      seatsTotal: 3,
      seatPrice: 100,
    });
    // Название — сразу, условия раунда — прежние.
    const pub = await p.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(pub.body.name).toBe('Груз после правки');
    expect(pub.body.round).toMatchObject({ id: c.round!.id, seatPrice: 100, seatsTotal: 3 });
    expect(pub.body.round!.prize.id).toBe(a.id);

    await endAgo(c.round!.id, '1 second');
    const out = (await svc().land(c.round!.id)) as CargoLanding;
    expect(out.result).toMatchObject({ status: 'landed', seatsSold: 1 });
    expect(out.result.prize.id).toBe(a.id);
    expect(out.winnerId).toBe(p.me.id);
    // В next (и в событии cargo:round) — приз нового раунда, а не приземлившегося.
    expect(out.next).toMatchObject({ number: 2, seatsTotal: 5, seatPrice: 300 });
    expect(out.next!.prize.id).toBe(b.id);
    expect(await roundRow(out.next!.id)).toMatchObject({
      prizeItemId: b.id,
      prizeValue: b.price,
      seatsTotal: 5,
      seatPrice: 300,
    });

    const audit = await auditOf('cargo.update', c.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entityType: 'cargo',
      before: { name: 'Груз админки', prizeItemId: a.id, seatsTotal: 3, seatPrice: 100 },
      after: {
        name: 'Груз после правки',
        prizeItemId: b.id,
        seatsTotal: 5,
        seatPrice: 300,
        roundId: null,
      },
    });
  });

  it('a disabled cargo plays its round out without a new one; enabling opens a round at once', async () => {
    const c = await createCargo({ seatsTotal: 4 });
    const off = await edit(c, { isActive: false });
    expect(off.body).toMatchObject({
      isActive: false,
      issue: null,
      round: { id: c.round!.id, status: 'open' },
    });
    const p = await playerWith(1_000);
    expect((await buy(p.client, c.slug, c.round!.id, 1)).status).toBe(200);
    await endAgo(c.round!.id, '1 second');
    const out = (await svc().land(c.round!.id)) as CargoLanding;
    expect(out.result.status).toBe('landed');
    expect(out.next).toBeNull();
    const after = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
    expect(after).toMatchObject({ round: null, issue: null, roundsLanded: 1 });
    expect((await new TestClient(app).get(`/api/v1/games/cs2/cargo/${c.slug}`)).status).toBe(404);
    expect(await db(app).transaction((tx) => svc().openRound(tx, c.id))).toBeNull();

    const opened = vi.spyOn(app.get(CargoNotifier), 'opened');
    try {
      const on = await edit(c, { isActive: true });
      expect(on.body).toMatchObject({
        isActive: true,
        issue: null,
        round: { number: 2, status: 'open' },
      });
      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened.mock.calls[0]![0]).toMatchObject({
        templateId: c.id,
        slug: c.slug,
        round: { id: on.body.round!.id, number: 2 },
      });
      const [audit] = (await auditOf('cargo.update', c.id)).slice(-1);
      expect(audit!.after).toMatchObject({ isActive: true, roundId: on.body.round!.id });
    } finally {
      opened.mockRestore();
    }
    expect((await new TestClient(app).get(`/api/v1/games/cs2/cargo/${c.slug}`)).status).toBe(200);
  });

  it('cancel (D33): exact refunds, refunded_at, public void seat, audit, notifications, no XP, next round', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    expect((await buy(a.client, c.slug, c.round!.id, 2)).status).toBe(200);
    expect((await buy(b.client, c.slug, c.round!.id, 3)).status).toBe(200);
    expect((await buy(a.client, c.slug, c.round!.id, 1)).status).toBe(200);
    expect(await userBalance(app, a.me.id)).toBe(700);
    expect(await userBalance(app, b.me.id)).toBe(700);
    const reason = 'Ошибка в призе, раунд отменён';
    const finished = vi.spyOn(app.get(CargoNotifier), 'finished');
    let res: TestResponse<AdminCargoRoundDetailDto>;
    try {
      res = await cancel(c.round!.id, reason);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // События после коммита: балансы участникам, cargo:result (cancelled), cargo:round следующего раунда.
      expect(finished).toHaveBeenCalledTimes(1);
      const l = finished.mock.calls[0]![0];
      expect(l.result).toMatchObject({
        roundId: c.round!.id,
        status: 'cancelled',
        landReason: null,
        refunded: true,
        winner: null,
        winningSeat: null,
      });
      expect(l.balances).toHaveLength(2);
      expect(l.balances).toEqual(
        expect.arrayContaining([
          { userId: a.me.id, balance: 1_000 },
          { userId: b.me.id, balance: 1_000 },
        ]),
      );
      expect(l.next?.number).toBe(2);
    } finally {
      finished.mockRestore();
    }
    const d = res.body;
    expect(d).toMatchObject({
      id: c.round!.id,
      number: 1,
      status: 'cancelled',
      seatsSold: 6,
      seatsTotal: 10,
      revenue: 600,
      cancelReason: reason,
      winner: null,
      winningSeat: null,
      landReason: null,
      templateId: c.id,
      templateName: 'Груз админки',
      game: 'cs2',
    });
    expect(d.finishedAt).not.toBeNull();
    // Участники: по числу мест, при равенстве — по первой покупке; диапазоны — покупки по порядку мест.
    expect(d.participants).toEqual([
      {
        user: expect.objectContaining({
          id: a.me.id,
          shortId: a.me.shortId,
          nickname: a.me.nickname,
        }),
        seats: 3,
        ranges: [
          [1, 2],
          [6, 6],
        ],
        spent: 300,
        firstAt: expect.any(String),
        refunded: true,
      },
      {
        user: expect.objectContaining({ id: b.me.id, nickname: b.me.nickname }),
        seats: 3,
        ranges: [[3, 5]],
        spent: 300,
        firstAt: expect.any(String),
        refunded: true,
      },
    ]);
    expect(await userBalance(app, a.me.id)).toBe(1_000);
    expect(await userBalance(app, b.me.id)).toBe(1_000);

    const refunds = await refundsOf(c.round!.id);
    expect(refunds.map((e) => e.userId).sort()).toEqual([a.me.id, b.me.id].sort());
    for (const e of refunds) {
      expect(e).toMatchObject({
        amount: 300,
        refType: 'cargo_round',
        actorId: adminId,
        reason,
        idempotencyKey: `cargo_refund:${c.round!.id}:${e.userId}`,
      });
    }
    const purchases = await db(app)
      .select()
      .from(cargoPurchases)
      .where(eq(cargoPurchases.roundId, c.round!.id))
      .orderBy(asc(cargoPurchases.seatFrom));
    expect(purchases).toHaveLength(3);
    for (const p of purchases) expect(p.refundedAt).not.toBeNull();
    const r = await roundRow(c.round!.id);
    expect(r).toMatchObject({
      status: 'cancelled',
      cancelReason: reason,
      cancelledBy: adminId,
      clientSeed: cargoClientSeed(purchases),
    });
    expect(d.voidSeat).toBe(r.voidSeat);

    // Отменённый исход публичен (D33): сид раскрыт, место, которое выиграло бы, воспроизводится.
    const proof = (
      await new TestClient(app).get<CargoProofDto>(`/api/v1/fair/proof/cargo/${c.round!.id}`)
    ).body;
    expect(proof).toMatchObject({
      status: 'cancelled',
      revealed: true,
      clientSeed: r.clientSeed,
      voidSeat: r.voidSeat,
      winningSeat: null,
      seatsSold: 6,
    });
    expect(verifyServerSeed(proof.serverSeed!, proof.serverSeedHash)).toBe(true);
    expect(cargoClientSeed(proof.purchases)).toBe(proof.clientSeed);
    expect(cargoWinningSeat(proof.serverSeed!, proof.clientSeed!, proof.seatsSold)).toBe(
      proof.voidSeat,
    );

    const audit = await auditOf('cargo_round.cancel', c.round!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entityType: 'cargo_round',
      reason,
      before: { status: 'open', seatsSold: 6 },
      after: { users: 2, gems: 600, purchases: 3, clientSeed: r.clientSeed, voidSeat: r.voidSeat },
    });
    for (const u of [a, b]) {
      const notes = (await outbox('notification.create', 'userId', u.me.id)).filter(
        (e) => (e.payload as { type: string }).type === 'cargo_refund',
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]!.payload).toMatchObject({
        params: { gems: 300, cargo: 'Груз админки', why: 'cancelled' },
        link: `/cs2/cargo/${c.slug}`,
      });
    }
    // XP за возвращённые гемы не начисляется (D12).
    expect(await outbox('wager.placed', 'sourceId', c.round!.id)).toHaveLength(0);

    const t = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
    expect(t.round).toMatchObject({ number: 2, status: 'open', seatsSold: 0 });
    expect(audit[0]!.after).toMatchObject({ nextRoundId: t.round!.id });
    // Участник отменённого раунда узнаётся и на странице груза (окно итога).
    const pub = (await a.client.get<CargoDetailDto>(`/api/v1/games/cs2/cargo/${c.slug}`)).body;
    expect(pub.lastResult).toMatchObject({
      roundId: c.round!.id,
      status: 'cancelled',
      refunded: true,
    });
    expect(pub.lastResultMySeats).toBe(3);
    expect(await reconcileCargo(db(app))).toEqual([]);

    // Бесплатный груз: возвращать нечего, ledger не трогается, но исход так же публичен.
    const f = await createCargo({ seatPrice: 0, seatsTotal: 5 });
    const fp = await newPlayer(app, 'caf');
    expect((await buy(fp.client, f.slug, f.round!.id, 1)).status).toBe(200);
    const fr = await cancel(f.round!.id, 'Отмена бесплатного груза');
    expect(fr.status).toBe(200);
    expect(fr.body).toMatchObject({ status: 'cancelled', seatsSold: 1, revenue: 0, voidSeat: 1 });
    expect(fr.body.participants).toEqual([
      expect.objectContaining({ seats: 1, spent: 0, refunded: false }),
    ]);
    expect(await refundsOf(f.round!.id)).toHaveLength(0);
    const [fa] = await auditOf('cargo_round.cancel', f.round!.id);
    expect(fa!.after).toMatchObject({ users: 0, gems: 0, voidSeat: 1 });
  });

  it('cancel races: two cancels → 200 + 409; landed → 409; bad reason → 400; buy vs cancel keeps money right', async () => {
    const c = await createCargo({ seatsTotal: 10 });
    const p = await playerWith(1_000);
    await buy(p.client, c.slug, c.round!.id, 1);
    const both = await Promise.all([
      admin.post<Err>(`${A}/cargo-rounds/${c.round!.id}/cancel`, { reason: 'Параллельная 1' }),
      admin.post<Err>(`${A}/cargo-rounds/${c.round!.id}/cancel`, { reason: 'Параллельная 2' }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.code).toBe('CARGO_ROUND_NOT_OPEN');
    expect(await refundsOf(c.round!.id)).toHaveLength(1);
    expect(await auditOf('cargo_round.cancel', c.round!.id)).toHaveLength(1);
    expect(await userBalance(app, p.me.id)).toBe(1_000);

    const round2 = (await openRoundOf(c.id))!;
    for (const reason of ['abc', '    abc   ', '']) {
      const bad = await admin.post<Err>(`${A}/cargo-rounds/${round2.id}/cancel`, { reason });
      expect(bad.status, reason).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    }
    const missing = await admin.post<Err>(`${A}/cargo-rounds/${newId()}/cancel`, {
      reason: 'Нет такого раунда',
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CARGO_ROUND_NOT_FOUND');
    expect((await openRoundOf(c.id))?.id).toBe(round2.id);

    const l = await createCargo({ seatsTotal: 2 });
    expect((await buy(p.client, l.slug, l.round!.id, 2)).body.result?.status).toBe('landed');
    const landed = await admin.post<Err>(`${A}/cargo-rounds/${l.round!.id}/cancel`, {
      reason: 'Поздно отменять',
    });
    expect(landed.status).toBe(409);
    expect(landed.body.error.code).toBe('CARGO_ROUND_NOT_OPEN');
    expect(await userBalance(app, p.me.id)).toBe(800);

    // Покупка параллельно с отменой: либо покупка опоздала (409, списания нет), либо успела — и её сумма вернулась
    // тем же возвратом. Кто стартует раньше — чередуется, чтобы встречались оба исхода; повтор цикла отмены при
    // сменившемся наборе платящих — детерминированно в следующем тесте.
    const q = await playerWith(1_000);
    const outcomes: number[] = [];
    const starts = [
      [0, 6],
      [6, 0],
      [0, 2],
      [2, 0],
      [0, 0],
    ] as const;
    for (const [i, [buyAt, cancelAt]] of starts.entries()) {
      const round = (await openRoundOf(c.id))!;
      expect((await buy(p.client, c.slug, round.id, 1)).status).toBe(200);
      const [bought, cancelled] = await Promise.all([
        sleep(buyAt).then(() => buy(q.client, c.slug, round.id, 1)),
        sleep(cancelAt).then(() => cancel(round.id, `Отмена в гонке ${i}`)),
      ]);
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      outcomes.push(bought.status);
      const refunds = await refundsOf(round.id);
      const mine = await db(app)
        .select()
        .from(cargoPurchases)
        .where(and(eq(cargoPurchases.roundId, round.id), eq(cargoPurchases.userId, q.me.id)));
      if (bought.status === 200) {
        expect(bought.body.roundId).toBe(round.id);
        expect(mine).toHaveLength(1);
        expect(mine[0]!.refundedAt).not.toBeNull();
        expect(refunds.find((e) => e.userId === q.me.id)?.amount).toBe(100);
        expect(cancelled.body.participants.map((x) => x.user.id)).toContain(q.me.id);
      } else {
        expect(bought.status).toBe(409);
        expect((bought.body as unknown as Err).error.code).toBe('CARGO_ROUND_CLOSED');
        expect(mine).toHaveLength(0);
        expect(refunds.find((e) => e.userId === q.me.id)).toBeUndefined();
      }
      expect(refunds.find((e) => e.userId === p.me.id)?.amount).toBe(100);
      expect(await userBalance(app, q.me.id)).toBe(1_000);
      expect(await userBalance(app, p.me.id)).toBe(800);
      expect(await reconcileCargo(db(app))).toEqual([]);
    }
    expect(outcomes.every((s) => s === 200 || s === 409)).toBe(true);
    expect(await app.get(LedgerService).reconcile(10_000)).toEqual([]);
  });

  // Две транзакции одновременно — нужно второе соединение пула (с TEST_DB_POOL_SIZE=1 покупка ждала бы отмену).
  it.skipIf(process.env.TEST_DB_POOL_SIZE === '1')(
    'cancel retries when a purchase commits between reading the payers and locking the round',
    async () => {
      const c = await createCargo({ seatsTotal: 10 });
      const p = await playerWith(1_000);
      const q = await playerWith(1_000);
      await buy(p.client, c.slug, c.round!.id, 1);
      // Отмена прочитала платящих ([p]) и заблокировала кошелёк p — здесь она ждёт, пока q покупает место.
      const ledger = app.get(LedgerService);
      const lockWallet = ledger.lockWallet.bind(ledger);
      let paused = false;
      let locksOfP = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const spy = vi.spyOn(ledger, 'lockWallet').mockImplementation(async (tx, userId) => {
        const balance = await lockWallet(tx, userId);
        if (userId === p.me.id) locksOfP++;
        if (userId === p.me.id && !paused) {
          paused = true;
          await gate;
        }
        return balance;
      });
      let res: TestResponse<AdminCargoRoundDetailDto>;
      try {
        const cancelling = cancel(c.round!.id, 'Отмена с повтором');
        for (let i = 0; i < 200 && !paused; i++) await sleep(10);
        expect(paused).toBe(true);
        const bought = await buy(q.client, c.slug, c.round!.id, 2);
        expect(bought.status).toBe(200);
        expect(bought.body).toMatchObject({ seatFrom: 2, seatTo: 3, paid: 200 });
        release();
        res = await cancelling;
      } finally {
        release();
        spy.mockRestore();
      }
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Повтор: кошелёк p блокировался и во второй попытке (уже вместе с q), и при возврате.
      expect(locksOfP).toBeGreaterThan(1);
      expect(res.body.participants.map((x) => [x.user.id, x.spent, x.refunded])).toEqual([
        [q.me.id, 200, true],
        [p.me.id, 100, true],
      ]);
      const refunds = await refundsOf(c.round!.id);
      expect(refunds.map((e) => [e.userId, e.amount]).sort()).toEqual(
        [
          [p.me.id, 100],
          [q.me.id, 200],
        ].sort(),
      );
      expect(await userBalance(app, p.me.id)).toBe(1_000);
      expect(await userBalance(app, q.me.id)).toBe(1_000);
      expect((await auditOf('cargo_round.cancel', c.round!.id))[0]!.after).toMatchObject({
        users: 2,
        gems: 300,
        purchases: 2,
      });
      expect(await reconcileCargo(db(app))).toEqual([]);
    },
  );

  it('round history: status filter and pages; round detail with participants', async () => {
    const c = await createCargo({ seatsTotal: 2, seatPrice: 50 });
    const a = await playerWith(1_000);
    const b = await playerWith(1_000);
    // №1 — распродан, №2 — по таймеру без продаж, №3 — отменён, №4 — идёт.
    const r1 = c.round!.id;
    const sold = await buy(a.client, c.slug, r1, 2);
    expect(sold.body.result?.status).toBe('landed');
    const r2 = sold.body.next!.id;
    await endAgo(r2, '1 second');
    const r3 = ((await svc().land(r2)) as CargoLanding).next!.id;
    expect((await buy(b.client, c.slug, r3, 1)).status).toBe(200);
    expect((await cancel(r3, 'Отмена для истории')).status).toBe(200);
    const r4 = (await openRoundOf(c.id))!.id;

    const page = (q: string) =>
      admin.get<AdminPageDto<AdminCargoRoundRowDto>>(`${A}/cargo/${c.id}/rounds${q}`);
    const p1 = (await page('?pageSize=2')).body;
    expect(p1).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(p1.items.map((r) => r.number)).toEqual([4, 3]);
    expect((await page('?pageSize=2&page=2')).body.items.map((r) => r.id)).toEqual([r2, r1]);
    expect((await page('?pageSize=2&page=3')).body.items).toEqual([]);

    const landed = (await page('?status=landed')).body;
    expect(landed.total).toBe(1);
    expect(landed.items[0]).toMatchObject({
      id: r1,
      number: 1,
      status: 'landed',
      seatsSold: 2,
      seatsTotal: 2,
      seatPrice: 50,
      revenue: 100,
      landReason: 'sold_out',
      voidSeat: null,
      cancelReason: null,
      winner: { id: a.me.id, shortId: a.me.shortId, nickname: a.me.nickname },
    });
    expect([1, 2]).toContain(landed.items[0]!.winningSeat);
    expect(landed.items[0]!.prize.id).toBe(c.prize.id);
    expect(landed.items[0]!.prizeValue).toBe(c.prize.price);
    expect((await page('?status=expired')).body.items).toEqual([
      expect.objectContaining({
        id: r2,
        landReason: 'deadline',
        revenue: 0,
        winner: null,
        winningSeat: null,
        voidSeat: null,
      }),
    ]);
    expect((await page('?status=cancelled')).body.items).toEqual([
      expect.objectContaining({
        id: r3,
        cancelReason: 'Отмена для истории',
        voidSeat: 1,
        revenue: 50,
        landReason: null,
        winner: null,
      }),
    ]);
    const open = (await page('?status=open')).body.items;
    expect(open.map((r) => r.id)).toEqual([r4]);
    expect(open[0]).toMatchObject({ finishedAt: null, revenue: 0 });
    expect((await page('?status=nope')).status).toBe(400);

    const d1 = (await admin.get<AdminCargoRoundDetailDto>(`${A}/cargo-rounds/${r1}`)).body;
    expect(d1).toMatchObject({
      id: r1,
      templateId: c.id,
      templateName: 'Груз админки',
      game: 'cs2',
      number: 1,
    });
    expect(d1.participants).toEqual([
      {
        user: expect.objectContaining({ id: a.me.id, shortId: a.me.shortId }),
        seats: 2,
        ranges: [[1, 2]],
        spent: 100,
        firstAt: expect.any(String),
        refunded: false,
      },
    ]);
    expect(Date.parse(d1.participants[0]!.firstAt)).toBeGreaterThanOrEqual(
      Date.parse(d1.startedAt),
    );
    const d4 = (await admin.get<AdminCargoRoundDetailDto>(`${A}/cargo-rounds/${r4}`)).body;
    expect(d4).toMatchObject({ status: 'open', participants: [] });

    const noTemplate = await admin.get<Err>(`${A}/cargo/${newId()}/rounds`);
    expect(noTemplate.status).toBe(404);
    expect(noTemplate.body.error.code).toBe('CARGO_NOT_FOUND');
    const noRound = await admin.get<Err>(`${A}/cargo-rounds/${newId()}`);
    expect(noRound.status).toBe(404);
    expect(noRound.body.error.code).toBe('CARGO_ROUND_NOT_FOUND');
    expect((await admin.get(`${A}/cargo-rounds/not-a-uuid`)).status).toBe(400);
  });

  it('reconciliation (D39): ledger and cargo are clean, the admin handle says ok', async () => {
    expect(await app.get(LedgerService).reconcile(10_000)).toEqual([]);
    expect(await reconcileCargo(db(app), 10_000)).toEqual([]);
    const res = await admin.get<AdminCargoReconciliationDto>(`${A}/cargo-reconciliation`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mismatches: [] });
    expect(Math.abs(Date.parse(res.body.checkedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('archive (D37): only without an open round; hidden from the list; read-only; never reopens; slug stays taken', async () => {
    const c = await createCargo();
    const blocked = await admin.delete<Err>(`${A}/cargo/${c.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'round_open', roundId: c.round!.id },
    });
    // Выключить, иначе отмена сразу откроет следующий раунд; затем отменить идущий.
    expect((await edit(c, { isActive: false })).status).toBe(200);
    expect((await cancel(c.round!.id, 'Убираем груз в архив')).status).toBe(200);
    expect(await openRoundOf(c.id)).toBeNull();
    const res = await admin.delete<AdminCargoDetailDto>(`${A}/cargo/${c.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: c.id, isActive: false, round: null, issue: null });
    expect(res.body.archivedAt).not.toBeNull();

    const list = (await admin.get<AdminCargoRowDto[]>(`${A}/games/cs2/cargo`)).body;
    expect(list.find((x) => x.id === c.id)).toBeUndefined();
    expect(list.every((x) => x.archivedAt === null)).toBe(true);
    const all = (await admin.get<AdminCargoRowDto[]>(`${A}/games/cs2/cargo?archived=1`)).body;
    expect(all.find((x) => x.id === c.id)?.archivedAt).toBe(res.body.archivedAt);
    const firstArchived = all.findIndex((x) => x.archivedAt !== null);
    expect(all.slice(firstArchived).every((x) => x.archivedAt !== null)).toBe(true);
    // Сидовые грузы на месте (список без архивных).
    for (const slug of ['light', 'black', 'free', 'signal', 'special']) {
      expect(list.map((x) => x.slug)).toContain(slug);
    }

    const put = await admin.put<Err>(
      `${A}/games/cs2/cargo/${c.id}`,
      cargoBody({ slug: c.slug, isActive: true }),
    );
    expect(put.status).toBe(409);
    expect(put.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'archived' } });
    // Раунд не откроет ни openRound, ни тикер.
    expect(await db(app).transaction((tx) => svc().openRound(tx, c.id))).toBeNull();
    expect((await svc().ensureOpenRounds()).map((o) => o.templateId)).not.toContain(c.id);
    expect(await openRoundOf(c.id)).toBeNull();
    const pub = await new TestClient(app).get<Err>(`/api/v1/games/cs2/cargo/${c.slug}`);
    expect(pub.status).toBe(404);
    expect(pub.body.error.code).toBe('CARGO_NOT_FOUND');

    const audit = await auditOf('cargo.archive', c.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entityType: 'cargo',
      before: { isActive: false, archivedAt: null },
      after: { isActive: false, archivedAt: res.body.archivedAt },
    });
    const again = await admin.delete<AdminCargoDetailDto>(`${A}/cargo/${c.id}`);
    expect(again.status).toBe(200);
    expect(again.body.archivedAt).toBe(res.body.archivedAt);
    expect(await auditOf('cargo.archive', c.id)).toHaveLength(1);
    // История читается, адрес остаётся занятым.
    expect(
      (await admin.get<AdminPageDto<AdminCargoRoundRowDto>>(`${A}/cargo/${c.id}/rounds`)).body
        .total,
    ).toBe(1);
    const dup = await admin.post<Err>(`${A}/games/cs2/cargo`, cargoBody({ slug: c.slug }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'slug' } });
    const unknown = await admin.delete<Err>(`${A}/cargo/${newId()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('CARGO_NOT_FOUND');
  });

  it('issue LANDING_STUCK with attempts and the cause; RTP now = prize / revenue', async () => {
    const prize = prizes[4]!;
    const c = await createCargo({ prizeItemId: prize.id, seatsTotal: 3, seatPrice: 10 });
    const p = await playerWith(1_000);
    await buy(p.client, c.slug, c.round!.id, 1);
    // Срок вышел больше минуты назад, а приземление ломается.
    await endAgo(c.round!.id, '2 minutes');
    const grant = vi
      .spyOn(app.get(InventoryService), 'grant')
      .mockRejectedValue(new Error('prize grant failed'));
    try {
      await expect(svc().land(c.round!.id)).rejects.toThrow('prize grant failed');
      const stuck = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
      expect(stuck.issue).toBe('LANDING_STUCK');
      expect(stuck.round).toMatchObject({
        id: c.round!.id,
        status: 'open',
        seatsSold: 1,
        revenue: 10,
        participants: 1,
        prizeValue: prize.price,
        lastLandError: 'prize grant failed',
      });
      expect(stuck.round!.landAttempts).toBeGreaterThanOrEqual(1);
      expect(stuck.round!.lastLandErrorAt).not.toBeNull();
      expect(stuck.round!.rtpNow).toBeCloseTo(prize.price / 10, 10);
      expect(stuck.round!.rtpNow!).toBeGreaterThan(1);
      expect(stuck.rtp).toBeCloseTo(prize.price / 30, 10);
      const list = (await admin.get<AdminCargoRowDto[]>(`${A}/games/cs2/cargo`)).body;
      expect(list.find((x) => x.id === c.id)?.issue).toBe('LANDING_STUCK');
    } finally {
      grant.mockRestore();
    }
    const out = (await svc().land(c.round!.id)) as CargoLanding;
    expect(out.result).toMatchObject({ status: 'landed', landReason: 'deadline' });
    const ok = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
    expect(ok).toMatchObject({
      issue: null,
      roundsLanded: 1,
      round: { number: 2, revenue: 0, rtpNow: null, landAttempts: 0 },
    });

    // Распроданный, но не приземлившийся раунд — тоже LANDING_STUCK (срок ещё не вышел).
    const s = await createCargo({ seatsTotal: 2, seatPrice: 10 });
    const fail = vi
      .spyOn(app.get(InventoryService), 'grant')
      .mockRejectedValueOnce(new Error('boom'));
    try {
      const last = await buy(p.client, s.slug, s.round!.id, 2);
      expect(last.body).toMatchObject({ result: null, round: { status: 'open', seatsSold: 2 } });
    } finally {
      fail.mockRestore();
    }
    const soldOut = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${s.id}`)).body;
    expect(soldOut).toMatchObject({
      issue: 'LANDING_STUCK',
      round: { seatsSold: 2, landAttempts: 1, lastLandError: 'boom' },
    });
    expect(((await svc().land(s.round!.id)) as CargoLanding).result.status).toBe('landed');
  });

  it('issues PRIZE_INACTIVE, PRIZE_GAME and NO_ROUND; the same disabled prize can still be saved', async () => {
    const prize = prizes[6]!;
    const c = await createCargo({ prizeItemId: prize.id });
    await setItemActive(prize.id, false);
    try {
      // Идущий раунд приз выдаст (D17), а новый не начнётся.
      const r1 = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
      expect(r1).toMatchObject({ issue: 'PRIZE_INACTIVE', round: { status: 'open' } });
      // Тот же выключенный приз не мешает правке (переименовать, выключить); выбрать его заново — нельзя.
      const renamed = await edit(c, { name: 'Переименованный груз' });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(renamed.body).toMatchObject({ name: 'Переименованный груз', issue: 'PRIZE_INACTIVE' });
      const other = await edit(c, { prizeItemId: prizes[7]!.id });
      expect(other.status).toBe(200);
      const back = await admin.put<Err>(
        `${A}/games/cs2/cargo/${c.id}`,
        cargoBody({ slug: c.slug, prizeItemId: prize.id }),
      );
      expect(back.status).toBe(400);
      expect(back.body.error).toMatchObject({
        code: 'CARGO_PRIZE_INVALID',
        details: { reason: 'inactive' },
      });
      await db(app)
        .update(cargoTemplates)
        .set({ prizeItemId: prize.id })
        .where(eq(cargoTemplates.id, c.id));
      expect((await cancel(c.round!.id, 'Приз выключен в каталоге')).status).toBe(200);
      const r2 = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
      expect(r2).toMatchObject({ round: null, issue: 'PRIZE_INACTIVE' });
      expect(r2.prize.id).toBe(prize.id);
    } finally {
      await setItemActive(prize.id, true);
    }
    // Приз снова включён, а раунд никто не открыл.
    const r3 = (await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body;
    expect(r3).toMatchObject({ round: null, issue: 'NO_ROUND' });
    // Приз другой игры — только прямой правкой БД (ручки такой не сохранят).
    await db(app)
      .update(cargoTemplates)
      .set({ prizeItemId: foreignItem.id })
      .where(eq(cargoTemplates.id, c.id));
    try {
      expect((await admin.get<AdminCargoDetailDto>(`${A}/cargo/${c.id}`)).body.issue).toBe(
        'PRIZE_GAME',
      );
    } finally {
      await db(app)
        .update(cargoTemplates)
        .set({ prizeItemId: prize.id })
        .where(eq(cargoTemplates.id, c.id));
    }
    // Сохранение активного груза без раунда открывает раунд сразу.
    const on = await edit(c, { prizeItemId: prize.id });
    expect(on.body).toMatchObject({ issue: null, round: { number: 2, status: 'open' } });
  });

  it('ids from the URL in upper case: audit, ledger and reconciliation get the canonical id', async () => {
    const c = await createCargo({ seatsTotal: 5 });
    const ID = c.id.toUpperCase();
    expect((await admin.get<AdminCargoDetailDto>(`${A}/cargo/${ID}`)).body.id).toBe(c.id);
    const p = await playerWith(1_000);
    expect((await buy(p.client, c.slug, c.round!.id, 2)).status).toBe(200);
    const off = await admin.put<AdminCargoDetailDto>(
      `${A}/games/cs2/cargo/${ID}`,
      cargoBody({
        slug: c.slug,
        seatsTotal: 5,
        isActive: false,
        prizeItemId: c.prize.id.toUpperCase(),
      }),
    );
    expect(off.status).toBe(200);
    expect(off.body.prize.id).toBe(c.prize.id);
    const res = await cancel(c.round!.id.toUpperCase(), 'Отмена по id прописными');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: c.round!.id, status: 'cancelled' });
    const hist = await admin.get<AdminPageDto<AdminCargoRoundRowDto>>(`${A}/cargo/${ID}/rounds`);
    expect(hist.body.items.map((r) => r.id)).toEqual([c.round!.id]);
    expect((await admin.get(`${A}/cargo-rounds/${c.round!.id.toUpperCase()}`)).status).toBe(200);
    expect((await admin.delete(`${A}/cargo/${ID}`)).status).toBe(200);

    expect(await auditOf('cargo.update', c.id)).toHaveLength(1);
    expect((await auditOf('cargo.update', c.id))[0]!.after).toMatchObject({
      prizeItemId: c.prize.id,
    });
    expect(await auditOf('cargo.archive', c.id)).toHaveLength(1);
    expect(await auditOf('cargo_round.cancel', c.round!.id)).toHaveLength(1);
    const refunds = await db(app)
      .select({ refId: ledgerEntries.refId, key: ledgerEntries.idempotencyKey })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.type, 'cargo_refund'), eq(ledgerEntries.userId, p.me.id)));
    expect(refunds).toEqual([
      { refId: c.round!.id, key: `cargo_refund:${c.round!.id}:${p.me.id}` },
    ]);
    expect(await userBalance(app, p.me.id)).toBe(1_000);
    expect(await reconcileCargo(db(app))).toEqual([]);
  });

  it('dashboard (D13): cargo mode counts landed paid rounds; free prizes reduce the total GGR', async () => {
    const dash = async () =>
      (await admin.get<AdminDashboardDto>(`${A}/dashboard?days=1&game=cs2`)).body;
    const cargoMode = (d: AdminDashboardDto) => d.modes.find((m) => m.mode === 'cargo')!;
    const [paidPrize, freePrize] = [prizes[8]!, prizes[9]!];
    const d0 = await dash();
    const m0 = cargoMode(d0);
    expect(m0).toBeDefined();

    const paid = await createCargo({ prizeItemId: paidPrize.id, seatsTotal: 2, seatPrice: 150 });
    const p = await playerWith(1_000);
    expect((await buy(p.client, paid.slug, paid.round!.id, 2)).body.result?.status).toBe('landed');
    // Отменённый раунд в ставки не входит: гемы вернулись.
    const cancelled = await createCargo({ prizeItemId: paidPrize.id, seatsTotal: 3 });
    await buy(p.client, cancelled.slug, cancelled.round!.id, 1);
    expect((await cancel(cancelled.round!.id)).status).toBe(200);
    const d1 = await dash();
    const m1 = cargoMode(d1);
    expect(m1.count - m0.count).toBe(1);
    expect(m1.wagered - m0.wagered).toBe(300);
    expect(m1.paid - m0.paid).toBe(paidPrize.price);
    expect(m1.ggr).toBe(m1.wagered - m1.paid);
    expect(m1.rtp).toBeCloseTo(m1.paid / m1.wagered, 10);
    expect(m1.targetRtp).toBeNull();
    expect(d1.ggr - d0.ggr).toBe(300 - paidPrize.price);

    const free = await createCargo({ prizeItemId: freePrize.id, seatsTotal: 2, seatPrice: 0 });
    expect((await buy(p.client, free.slug, free.round!.id, 1)).status).toBe(200);
    await endAgo(free.round!.id, '1 second');
    expect(((await svc().land(free.round!.id)) as CargoLanding).result.status).toBe('landed');
    const d2 = await dash();
    const m2 = cargoMode(d2);
    expect(m2.count - m1.count).toBe(1);
    expect(m2.wagered).toBe(m1.wagered);
    expect(m2.paid).toBe(m1.paid);
    expect(d2.ggr - d1.ggr).toBe(-freePrize.price);
  });
});
