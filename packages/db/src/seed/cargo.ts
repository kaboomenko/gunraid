import { cargoImageUrl, type CargoImageKind } from '@gunraid/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { newId } from '../ids.js';
import { cargoTemplates, games, items } from '../schema/index.js';

interface CargoSeed {
  slug: CargoImageKind;
  name: string;
  seatsTotal: number;
  /** Приз — самый дешёвый активный предмет игры не дешевле этого порога (гемы). */
  prizeFloor: number;
  hours: number;
  free?: boolean;
  perUserLimit?: number;
  /** Условие участия против мультиаккаунтов (D10): пополнение за последние N дней. */
  depositWithinDays?: number;
  sortOrder: number;
}

/** Пять видов груза на каждую игру; числа правятся в админке (этап A). Минимума продаж у сидов нет (D36). */
const CARGOS: CargoSeed[] = [
  {
    slug: 'light',
    name: 'Лёгкий груз',
    seatsTotal: 100,
    prizeFloor: 13_700,
    hours: 24,
    sortOrder: 1,
  },
  {
    slug: 'black',
    name: 'Чёрный груз',
    seatsTotal: 200,
    prizeFloor: 30_000,
    hours: 48,
    sortOrder: 2,
  },
  {
    slug: 'free',
    name: 'Бесплатный груз',
    seatsTotal: 100,
    prizeFloor: 1_000,
    hours: 24,
    free: true,
    perUserLimit: 1,
    depositWithinDays: 30,
    sortOrder: 3,
  },
  {
    slug: 'signal',
    name: 'Сигнальный груз',
    seatsTotal: 50,
    prizeFloor: 5_000,
    hours: 12,
    perUserLimit: 10,
    sortOrder: 4,
  },
  {
    slug: 'special',
    name: 'Особый груз',
    seatsTotal: 500,
    prizeFloor: 80_000,
    hours: 72,
    sortOrder: 5,
  },
];

/** Самый дешёвый активный предмет не дешевле порога; если такого нет — самый дорогой активный дешевле порога. */
async function prizeFor(db: Db, gameId: number, floor: number) {
  const base = and(eq(items.gameId, gameId), eq(items.isActive, true));
  const [above] = await db
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(base, sql`${items.price} >= ${floor}`))
    .orderBy(asc(items.price), asc(items.id))
    .limit(1);
  if (above) return above;
  const [below] = await db
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(base, sql`${items.price} < ${floor}`))
    .orderBy(desc(items.price), asc(items.id))
    .limit(1);
  return below ?? null;
}

/**
 * Демо-грузы (по 5 на игру). Идемпотентно: существующий slug не трогается — правки админки не перетираются,
 * заархивированный сидовый груз не создаётся заново (unique-индекс по slug полный, D37). Раунды сиды не создают
 * (D35): server seed шифруется только в API — раунды открывает тикер воркера через ~5 с после старта.
 */
export async function seedCargo(db: Db): Promise<void> {
  const gameRows = await db.select({ id: games.id }).from(games).orderBy(asc(games.id));
  for (const g of gameRows) {
    const values: Array<typeof cargoTemplates.$inferInsert> = [];
    for (const c of CARGOS) {
      const prize = await prizeFor(db, g.id, c.prizeFloor);
      if (!prize) continue;
      values.push({
        id: newId(),
        gameId: g.id,
        slug: c.slug,
        name: { ru: c.name },
        imageUrl: cargoImageUrl(c.slug),
        prizeItemId: prize.id,
        seatsTotal: c.seatsTotal,
        // RTP ≈ 90 % при распродаже (бриф): ceil(приз / (0,9 × N)) — в целых, без ошибок округления.
        seatPrice: c.free ? 0 : Math.max(1, Math.ceil((prize.price * 10) / (9 * c.seatsTotal))),
        perUserLimit: c.perUserLimit ?? null,
        durationMinutes: c.hours * 60,
        depositWithinDays: c.depositWithinDays ?? null,
        minSeatsToLand: null,
        isActive: true,
        sortOrder: c.sortOrder,
      });
    }
    if (!values.length) continue;
    await db
      .insert(cargoTemplates)
      .values(values)
      .onConflictDoNothing({ target: [cargoTemplates.gameId, cargoTemplates.slug] });
  }
}
