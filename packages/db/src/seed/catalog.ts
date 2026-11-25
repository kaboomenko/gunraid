import { and, eq, like, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { newId } from '../ids.js';
import {
  collections,
  fxRates,
  games,
  itemModels,
  itemTypes,
  items,
  rarities,
} from '../schema/index.js';
import {
  CS2_RARITIES,
  ITEM_TYPE_ROWS,
  SO2_RARITIES,
  TEST_FX_RATES,
  WEAR_FLOATS,
  WEAR_LABELS,
  type ItemSeed,
  type ModelSeed,
  type RaritySeed,
} from './catalog-data.js';
import {
  CS2_COLLECTIONS,
  CS2_ITEMS,
  CS2_MODELS,
  SO2_COLLECTIONS,
  SO2_ITEMS,
  SO2_MODELS,
} from './real-catalog.js';

/** Картинки прежнего демо-каталога (вымышленные скины) — собственные плейсхолдеры. */
const PLACEHOLDER_PREFIX = '/media/demo/';

export async function seedItemTypes(db: Db): Promise<void> {
  await db.insert(itemTypes).values(ITEM_TYPE_ROWS).onConflictDoNothing({ target: itemTypes.code });
}

export async function seedFxRates(db: Db): Promise<void> {
  await db
    .insert(fxRates)
    .values(TEST_FX_RATES.map((r) => ({ ...r, source: 'test' })))
    .onConflictDoNothing({ target: fxRates.currency });
}

async function gameIdByCode(db: Db, code: string): Promise<number | null> {
  const [row] = await db.select({ id: games.id }).from(games).where(eq(games.code, code)).limit(1);
  return row?.id ?? null;
}

function cs2Name(model: ModelSeed, it: ItemSeed): string {
  const star = model.type === 'knife' || model.type === 'gloves' ? '★ ' : '';
  const st = it.stattrak ? 'StatTrak™ ' : '';
  const wear = it.wear ? ` (${WEAR_LABELS[it.wear]})` : '';
  return `${star}${st}${model.name} | ${it.skin}${wear}`;
}

function so2Name(model: ModelSeed, it: ItemSeed): string {
  return `${model.name} "${it.skin}"${it.stattrak ? ' StatTrack' : ''}`;
}

async function seedGameCatalog(
  db: Db,
  gameCode: string,
  rarityRows: RaritySeed[],
  modelRows: ModelSeed[],
  collectionRows: Array<{ code: string; name: string }>,
  itemRows: ItemSeed[],
  naming: (m: ModelSeed, it: ItemSeed) => string,
): Promise<void> {
  const gameId = await gameIdByCode(db, gameCode);
  if (!gameId) return;

  await db
    .insert(rarities)
    .values(
      rarityRows.map((r, i) => ({
        gameId,
        code: r.code,
        name: { ru: r.name },
        color: r.color,
        sortOrder: i + 1,
      })),
    )
    .onConflictDoNothing();
  const types = await db.select().from(itemTypes);
  const typeId = (code: string) => {
    const t = types.find((x) => x.code === code);
    if (!t) throw new Error(`item type ${code} not seeded`);
    return t.id;
  };
  await db
    .insert(itemModels)
    .values(
      modelRows.map((m, i) => ({
        gameId,
        typeId: typeId(m.type),
        code: m.code,
        name: m.name,
        sortOrder: i + 1,
      })),
    )
    .onConflictDoNothing();
  if (collectionRows.length) {
    await db
      .insert(collections)
      .values(collectionRows.map((c) => ({ gameId, code: c.code, name: c.name })))
      .onConflictDoNothing();
  }

  const rarityMap = new Map(
    (await db.select().from(rarities).where(eq(rarities.gameId, gameId))).map((r) => [
      r.code,
      r.id,
    ]),
  );
  const modelMap = new Map(
    (await db.select().from(itemModels).where(eq(itemModels.gameId, gameId))).map((m) => [
      m.code,
      m,
    ]),
  );
  const collectionMap = new Map(
    (await db.select().from(collections).where(eq(collections.gameId, gameId))).map((c) => [
      c.code,
      c.id,
    ]),
  );

  const rows = itemRows.map((it) => {
    const seedModel = modelRows.find((m) => m.code === it.model);
    const model = modelMap.get(it.model);
    const rarityId = rarityMap.get(it.rarity);
    if (!seedModel || !model || !rarityId) throw new Error(`bad seed item ${it.model}/${it.skin}`);
    const fullName = naming(seedModel, it);
    const floats = it.wear ? WEAR_FLOATS[it.wear] : null;
    return {
      id: newId(),
      gameId,
      typeId: model.typeId,
      modelId: model.id,
      rarityId,
      collectionId: it.collection ? (collectionMap.get(it.collection) ?? null) : null,
      skinName: it.skin,
      fullName,
      marketName: fullName,
      imageUrl:
        it.image ??
        `${PLACEHOLDER_PREFIX}${seedModel.shape}.svg?c1=${it.colors?.[0] ?? '9AA4B2'}&c2=${it.colors?.[1] ?? '2A2D36'}`,
      price: it.price,
      isStattrak: Boolean(it.stattrak),
      wear: it.wear ?? null,
      floatMin: floats?.[0] ?? null,
      floatMax: floats?.[1] ?? null,
      isWithdrawable: it.withdrawable ?? true,
    };
  });
  await db.insert(items).values(rows).onConflictDoNothing();

  // Базы, созданные с прежним вымышленным каталогом: его предметы снимаем с витрины
  // (в инвентарях и истории они остаются), кейсы пересобирает seedCases.
  if (itemRows.some((it) => it.image)) {
    await db
      .update(items)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(items.gameId, gameId),
          eq(items.isActive, true),
          like(items.imageUrl, `${PLACEHOLDER_PREFIX}%`),
        ),
      );
  }
}

export async function seedCatalog(db: Db): Promise<void> {
  await seedItemTypes(db);
  await seedGameCatalog(db, 'cs2', CS2_RARITIES, CS2_MODELS, CS2_COLLECTIONS, CS2_ITEMS, cs2Name);
  await seedGameCatalog(
    db,
    'standoff2',
    SO2_RARITIES,
    SO2_MODELS,
    SO2_COLLECTIONS,
    SO2_ITEMS,
    so2Name,
  );
}

/** Детерминированная выборка предметов игры (для демо-инвентаря). */
export async function pickDemoItems(db: Db, gameCode: string, count: number) {
  const gameId = await gameIdByCode(db, gameCode);
  if (!gameId) return [];
  const all = await db
    .select({ id: items.id, price: items.price, gameId: items.gameId })
    .from(items)
    .where(and(eq(items.gameId, gameId), eq(items.isActive, true)))
    .orderBy(items.marketName);
  const picked = [];
  for (let i = 0; i < all.length && picked.length < count; i += 3) {
    const row = all[i];
    if (row && row.price < 20000) picked.push(row);
  }
  return picked;
}
