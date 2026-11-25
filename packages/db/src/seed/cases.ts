import { caseRtp, fitOddsToRtp } from '@gunraid/game-core';
import { and, asc, eq, gte, inArray, lte, max, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { newId } from '../ids.js';
import {
  banners,
  caseCategories,
  caseItems,
  caseRevisions,
  cases,
  games,
  itemTypes,
  items,
  rarities,
} from '../schema/index.js';
import { planContents as planForLevel, spread } from './case-planner.js';
import { BANNERS, CASE_CATEGORIES, CS2_CASES, SO2_CASES, type CaseSeed } from './cases-data.js';

type TypeRows = Array<{ id: number; code: string }>;
type GameRef = { id: number; code: string };

/**
 * Состав демо-кейса. Кейсы из макета — подбор под уровень адреналина (case-planner),
 * бонусные — предметы из диапазона цен, шансы под целевой RTP / ожидаемую стоимость.
 */
async function planContents(
  db: Db,
  game: GameRef,
  s: CaseSeed,
  price: number,
  typeRows: TypeRows,
): Promise<{
  entries: Array<{ itemId: string; odds: number; price: number }>;
  rtp: number | null;
  isFree: boolean;
} | null> {
  const isFree = s.kind === 'free';
  if (!s.pick) {
    if (isFree || !s.adrenaline) return null;
    const pool = await db
      .select({
        id: items.id,
        price: items.price,
        rarityRank: rarities.sortOrder,
        rarity: rarities.code,
      })
      .from(items)
      .innerJoin(rarities, eq(rarities.id, items.rarityId))
      .where(and(eq(items.gameId, game.id), eq(items.isActive, true)));
    const wanted = s.rarity?.[game.code as 'standoff2' | 'cs2'];
    const prefer = wanted ? pool.find((p) => p.rarity === wanted)?.rarityRank : undefined;
    const plan = planForLevel(pool, price, s.target, s.adrenaline, s.count ?? 10, prefer);
    return plan ? { entries: plan.entries, rtp: plan.rtp, isFree } : null;
  }
  const pick = s.pick;
  const conds = [
    eq(items.gameId, game.id),
    eq(items.isActive, true),
    gte(items.price, pick.minPrice),
    lte(items.price, pick.maxPrice),
  ];
  if (pick.types?.length) {
    const ids = typeRows.filter((t) => pick.types?.includes(t.code)).map((t) => t.id);
    conds.push(inArray(items.typeId, ids));
  }
  const pool = await db
    .select({ id: items.id, price: items.price })
    .from(items)
    .where(and(...conds))
    .orderBy(asc(items.price), asc(items.marketName));
  const chosen = spread(pool, pick.count);
  if (chosen.length < 2) return null;

  const odds = fitOddsToRtp(
    chosen.map((c) => c.price),
    isFree ? 1 : price,
    s.target,
  );
  const entries = chosen.map((c, i) => ({
    itemId: c.id,
    odds: odds[i] as number,
    price: c.price,
  }));
  return { entries, rtp: caseRtp(entries, price), isFree };
}

/**
 * Демо-кейс, собранный из снятых с витрины предметов (прежний вымышленный каталог),
 * пересобираем из актуального каталога новой ревизией — история открытий остаётся проверяемой.
 */
async function refreshDemoCase(
  db: Db,
  game: GameRef,
  existing: { id: string; price: number },
  s: CaseSeed,
  typeRows: TypeRows,
): Promise<void> {
  const [stale] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caseItems)
    .innerJoin(items, eq(items.id, caseItems.itemId))
    .where(and(eq(caseItems.caseId, existing.id), eq(items.isActive, false)));
  if (!stale || stale.n === 0) return;
  const plan = await planContents(db, game, s, existing.price, typeRows);
  if (!plan) return;
  const { entries, rtp } = plan;
  await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ v: max(caseRevisions.version) })
      .from(caseRevisions)
      .where(eq(caseRevisions.caseId, existing.id));
    const revisionId = newId();
    await tx.insert(caseRevisions).values({
      id: revisionId,
      caseId: existing.id,
      version: (last?.v ?? 0) + 1,
      contents: entries.map((e) => ({ itemId: e.itemId, odds: e.odds })),
      price: existing.price,
      rtp: rtp === null ? null : rtp.toFixed(6),
    });
    await tx.delete(caseItems).where(eq(caseItems.caseId, existing.id));
    await tx.insert(caseItems).values(
      entries.map((e, i) => ({
        caseId: existing.id,
        itemId: e.itemId,
        odds: e.odds,
        sortOrder: i + 1,
      })),
    );
    await tx.update(cases).set({ currentRevisionId: revisionId }).where(eq(cases.id, existing.id));
  });
}

async function seedGameCases(db: Db, gameCode: string, seeds: CaseSeed[]): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.code, gameCode));
  if (!game) return;
  await db
    .insert(caseCategories)
    .values(
      CASE_CATEGORIES.map((c) => ({
        gameId: game.id,
        code: c.code,
        name: { ru: c.name },
        sortOrder: c.sortOrder,
      })),
    )
    .onConflictDoNothing();
  const cats = new Map(
    (await db.select().from(caseCategories).where(eq(caseCategories.gameId, game.id))).map((c) => [
      c.code,
      c.id,
    ]),
  );
  const typeRows = await db.select().from(itemTypes);

  for (const [index, s] of seeds.entries()) {
    const [exists] = await db
      .select({ id: cases.id, price: cases.price })
      .from(cases)
      .where(and(eq(cases.gameId, game.id), eq(cases.slug, s.slug)));
    if (exists) {
      await refreshDemoCase(db, game, exists, s, typeRows);
      continue;
    }

    const plan = await planContents(db, game, s, s.price, typeRows);
    if (!plan) continue;
    const { entries, rtp, isFree } = plan;

    const caseId = newId();
    const revisionId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(cases).values({
        id: caseId,
        gameId: game.id,
        categoryId: cats.get(s.category) as number,
        slug: s.slug,
        name: { ru: s.name },
        imageUrl: s.image
          ? `/media/cases/${s.image}.webp`
          : `/media/demo/chest.svg?c1=${s.accent}&c2=${s.secondary ?? '2A2D36'}`,
        accentColor: `#${s.accent}`,
        price: s.price,
        kind: isFree ? 'free' : 'paid',
        minLevel: s.minLevel ?? null,
        cooldownSeconds: s.cooldownHours ? s.cooldownHours * 3600 : null,
        supplyTotal: s.supply ?? null,
        adrenaline: s.adrenaline ?? null,
        sortOrder: index + 1,
      });
      await tx
        .insert(caseItems)
        .values(
          entries.map((e, i) => ({ caseId, itemId: e.itemId, odds: e.odds, sortOrder: i + 1 })),
        );
      await tx.insert(caseRevisions).values({
        id: revisionId,
        caseId,
        version: 1,
        contents: entries.map((e) => ({ itemId: e.itemId, odds: e.odds })),
        price: s.price,
        rtp: rtp === null ? null : rtp.toFixed(6),
      });
      await tx.update(cases).set({ currentRevisionId: revisionId }).where(eq(cases.id, caseId));
    });
  }

  const [hasBanner] = await db
    .select({ id: banners.id })
    .from(banners)
    .where(eq(banners.gameId, game.id))
    .limit(1);
  if (!hasBanner) {
    await db.insert(banners).values(
      BANNERS.map((b, i) => ({
        id: newId(),
        gameId: game.id,
        title: { ru: b.title },
        subtitle: { ru: b.subtitle },
        link: b.link.replace('{game}', game.code),
        accentColor: b.accent,
        sortOrder: i + 1,
      })),
    );
  }
}

export async function seedCases(db: Db): Promise<void> {
  await seedGameCases(db, 'standoff2', SO2_CASES);
  await seedGameCases(db, 'cs2', CS2_CASES);
}
