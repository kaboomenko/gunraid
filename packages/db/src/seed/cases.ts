import { caseRtp, fitOddsToRtp } from '@gunraid/game-core';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
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
} from '../schema/index.js';
import { BANNERS, CASE_CATEGORIES, CS2_CASES, SO2_CASES, type CaseSeed } from './cases-data.js';

function spread<T>(list: T[], count: number): T[] {
  if (list.length <= count) return list;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (list.length - 1)) / (count - 1));
    const v = list[idx];
    if (v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
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
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.gameId, game.id), eq(cases.slug, s.slug)));
    if (exists) continue;

    const conds = [
      eq(items.gameId, game.id),
      eq(items.isActive, true),
      gte(items.price, s.pick.minPrice),
      lte(items.price, s.pick.maxPrice),
    ];
    if (s.pick.types?.length) {
      const ids = typeRows.filter((t) => s.pick.types?.includes(t.code)).map((t) => t.id);
      conds.push(inArray(items.typeId, ids));
    }
    const pool = await db
      .select({ id: items.id, price: items.price })
      .from(items)
      .where(and(...conds))
      .orderBy(asc(items.price), asc(items.marketName));
    const chosen = spread(pool, s.pick.count);
    if (chosen.length < 2) continue;

    const isFree = s.kind === 'free';
    const odds = isFree
      ? fitOddsToRtp(
          chosen.map((c) => c.price),
          1,
          s.target,
        )
      : fitOddsToRtp(
          chosen.map((c) => c.price),
          s.price,
          s.target,
        );
    const entries = chosen.map((c, i) => ({
      itemId: c.id,
      odds: odds[i] as number,
      price: c.price,
    }));
    const rtp = caseRtp(entries, s.price);

    const caseId = newId();
    const revisionId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(cases).values({
        id: caseId,
        gameId: game.id,
        categoryId: cats.get(s.category) as number,
        slug: s.slug,
        name: { ru: s.name },
        imageUrl: `/media/demo/case.svg?c1=${s.accent}&c2=${s.secondary}`,
        accentColor: `#${s.accent}`,
        price: s.price,
        kind: isFree ? 'free' : 'paid',
        minLevel: s.minLevel ?? null,
        cooldownSeconds: s.cooldownHours ? s.cooldownHours * 3600 : null,
        supplyTotal: s.supply ?? null,
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
