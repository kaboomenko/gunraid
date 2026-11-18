import { Inject, Injectable } from '@nestjs/common';
import {
  caseItems,
  cases,
  collections,
  itemModels,
  itemTypes,
  items,
  rarities,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import type {
  ItemDetailDto,
  ItemDto,
  ItemFacetsDto,
  ItemsPageDto,
  ItemsQuery,
  RarityDto,
} from '@gunraid/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  max,
  min,
  type SQL,
} from 'drizzle-orm';
import { oddsToPercent } from '@gunraid/game-core';
import { DB } from '../../core/tokens.js';
import { notFound } from '../../common/app-error.js';
import { itemColumns, localize, toItemDto, toRarityDto, type ItemRow } from './item-mapper.js';

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private baseItemQuery(tx: DbOrTx = this.db) {
    return tx
      .select(itemColumns)
      .from(items)
      .innerJoin(rarities, eq(rarities.id, items.rarityId))
      .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
      .leftJoin(itemModels, eq(itemModels.id, items.modelId));
  }

  async rarities(gameId: number): Promise<RarityDto[]> {
    const rows = await this.db
      .select()
      .from(rarities)
      .where(eq(rarities.gameId, gameId))
      .orderBy(asc(rarities.sortOrder));
    return rows.map(toRarityDto);
  }

  async list(gameId: number, q: ItemsQuery): Promise<ItemsPageDto> {
    const where: SQL[] = [eq(items.gameId, gameId), eq(items.isActive, true)];
    if (q.q) where.push(ilike(items.fullName, `%${escapeLike(q.q)}%`));
    if (q.rarity?.length) where.push(inArray(rarities.code, q.rarity));
    if (q.type?.length) where.push(inArray(itemTypes.code, q.type));
    if (q.model?.length) where.push(inArray(itemModels.code, q.model));
    if (q.priceMin !== undefined) where.push(gte(items.price, q.priceMin));
    if (q.priceMax !== undefined) where.push(lte(items.price, q.priceMax));
    if (q.stattrak) where.push(eq(items.isStattrak, q.stattrak === 'true'));
    const cond = and(...where);

    const order =
      q.sort === 'price_asc'
        ? [asc(items.price), asc(items.fullName)]
        : q.sort === 'rarity_desc'
          ? [desc(rarities.sortOrder), desc(items.price)]
          : q.sort === 'name_asc'
            ? [asc(items.fullName)]
            : q.sort === 'newest'
              ? [desc(items.createdAt), desc(items.price)]
              : [desc(items.price), asc(items.fullName)];

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.baseItemQuery()
        .where(cond)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(items)
        .innerJoin(rarities, eq(rarities.id, items.rarityId))
        .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
        .leftJoin(itemModels, eq(itemModels.id, items.modelId))
        .where(cond),
    ]);
    return { items: (rows as ItemRow[]).map(toItemDto), total, page: q.page, pageSize: q.pageSize };
  }

  async facets(gameId: number): Promise<ItemFacetsDto> {
    const active = and(eq(items.gameId, gameId), eq(items.isActive, true));
    const [rarityRows, typeRows, modelRows, [range]] = await Promise.all([
      this.rarities(gameId),
      this.db
        .select({ code: itemTypes.code, name: itemTypes.name, count: count() })
        .from(items)
        .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
        .where(active)
        .groupBy(itemTypes.code, itemTypes.name, itemTypes.sortOrder)
        .orderBy(asc(itemTypes.sortOrder)),
      this.db
        .select({
          code: itemModels.code,
          name: itemModels.name,
          typeCode: itemTypes.code,
          count: count(),
        })
        .from(items)
        .innerJoin(itemModels, eq(itemModels.id, items.modelId))
        .innerJoin(itemTypes, eq(itemTypes.id, itemModels.typeId))
        .where(active)
        .groupBy(itemModels.code, itemModels.name, itemTypes.code, itemModels.sortOrder)
        .orderBy(asc(itemModels.sortOrder)),
      this.db
        .select({ min: min(items.price), max: max(items.price) })
        .from(items)
        .where(active),
    ]);
    return {
      rarities: rarityRows,
      types: typeRows.map((t) => ({ code: t.code, name: localize(t.name), count: t.count })),
      models: modelRows,
      priceMin: Number(range?.min ?? 0),
      priceMax: Number(range?.max ?? 0),
    };
  }

  async getItem(gameId: number, itemId: string, tx: DbOrTx = this.db): Promise<ItemDto> {
    const [row] = await this.baseItemQuery(tx)
      .where(and(eq(items.id, itemId), eq(items.gameId, gameId)))
      .limit(1);
    if (!row) throw notFound('ITEM_NOT_FOUND');
    return toItemDto(row as ItemRow);
  }

  async detail(gameId: number, itemId: string): Promise<ItemDetailDto> {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw notFound('ITEM_NOT_FOUND');
    const item = await this.getItem(gameId, itemId);
    const [col] = await this.db
      .select({ name: collections.name })
      .from(items)
      .innerJoin(collections, eq(collections.id, items.collectionId))
      .where(eq(items.id, itemId))
      .limit(1);
    return { ...item, collection: col?.name ?? null, cases: await this.casesContaining(itemId) };
  }

  /** В каких кейсах встречается предмет и с каким шансом. */
  protected async casesContaining(itemId: string): Promise<ItemDetailDto['cases']> {
    const rows = await this.db
      .select({
        slug: cases.slug,
        name: cases.name,
        imageUrl: cases.imageUrl,
        price: cases.price,
        odds: caseItems.odds,
      })
      .from(caseItems)
      .innerJoin(cases, eq(cases.id, caseItems.caseId))
      .where(and(eq(caseItems.itemId, itemId), eq(cases.isActive, true)))
      .orderBy(desc(caseItems.odds));
    return rows.map((r) => ({
      slug: r.slug,
      name: localize(r.name),
      imageUrl: r.imageUrl,
      price: r.price,
      chance: oddsToPercent(r.odds),
    }));
  }

  async getItemsByIds(ids: string[], tx: DbOrTx = this.db): Promise<Map<string, ItemDto>> {
    if (!ids.length) return new Map();
    const rows = await this.baseItemQuery(tx).where(inArray(items.id, ids));
    return new Map((rows as ItemRow[]).map((r) => [r.id, toItemDto(r)]));
  }
}
