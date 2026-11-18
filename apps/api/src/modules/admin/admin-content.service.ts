import { Inject, Injectable } from '@nestjs/common';
import {
  caseCategories,
  caseItems,
  caseOpenings,
  caseRevisions,
  cases,
  itemModels,
  itemPriceHistory,
  itemTypes,
  items,
  newId,
  rarities,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import { caseRtp, validateOdds } from '@gunraid/game-core';
import type {
  AdminBulkPriceBody,
  AdminCaseBody,
  AdminCaseCategoryDto,
  AdminCaseContentsBody,
  AdminCaseDetailDto,
  AdminCaseRowDto,
  AdminItemDto,
  AdminItemPatchBody,
  AdminItemsQuery,
  AdminPageDto,
  AdminRarityDto,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { itemColumns, localize, toItemDto, type ItemRow } from '../catalog/item-mapper.js';
import type { GameRow } from '../games/games.service.js';

type CaseRow = typeof cases.$inferSelect;

/** Контент: кейсы (состав и шансы — новой ревизией), предметы, редкости, массовое изменение цен. */
@Injectable()
export class AdminContentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Кейсы ----------

  async categories(game: GameRow): Promise<AdminCaseCategoryDto[]> {
    const rows = await this.db
      .select()
      .from(caseCategories)
      .where(eq(caseCategories.gameId, game.id))
      .orderBy(asc(caseCategories.sortOrder));
    return rows.map((r) => ({ id: r.id, code: r.code, name: localize(r.name) }));
  }

  private async currentRtp(c: CaseRow, tx: DbOrTx = this.db): Promise<number | null> {
    if (!c.currentRevisionId || c.price <= 0) return null;
    const [rev] = await tx
      .select({ contents: caseRevisions.contents })
      .from(caseRevisions)
      .where(eq(caseRevisions.id, c.currentRevisionId));
    if (!rev) return null;
    const prices = await tx
      .select({ id: items.id, price: items.price })
      .from(items)
      .where(
        inArray(
          items.id,
          rev.contents.map((e) => e.itemId),
        ),
      );
    const map = new Map(prices.map((p) => [p.id, p.price]));
    return caseRtp(
      rev.contents.map((e) => ({ odds: e.odds, price: map.get(e.itemId) ?? 0 })),
      c.price,
    );
  }

  async listCases(game: GameRow): Promise<AdminCaseRowDto[]> {
    const rows = await this.db
      .select({
        c: cases,
        categoryCode: caseCategories.code,
        itemsCount: sql<number>`(select count(*)::int from case_items ci where ci.case_id = ${cases.id})`,
        opened: sql<number>`(select count(*)::int from case_openings co where co.case_id = ${cases.id})`,
      })
      .from(cases)
      .innerJoin(caseCategories, eq(caseCategories.id, cases.categoryId))
      .where(eq(cases.gameId, game.id))
      .orderBy(asc(caseCategories.sortOrder), asc(cases.sortOrder), asc(cases.price));
    const out: AdminCaseRowDto[] = [];
    for (const r of rows) {
      out.push(this.toRow(r.c, r.categoryCode, r.itemsCount, r.opened, await this.currentRtp(r.c)));
    }
    return out;
  }

  private toRow(
    c: CaseRow,
    categoryCode: string,
    itemsCount: number,
    opened: number,
    rtp: number | null,
  ): AdminCaseRowDto {
    return {
      id: c.id,
      slug: c.slug,
      name: localize(c.name),
      imageUrl: c.imageUrl,
      accentColor: c.accentColor,
      price: c.price,
      kind: c.kind,
      categoryId: c.categoryId,
      categoryCode,
      isActive: c.isActive,
      supplyTotal: c.supplyTotal,
      supplyUsed: c.supplyUsed,
      minLevel: c.minLevel,
      cooldownSeconds: c.cooldownSeconds,
      sortOrder: c.sortOrder,
      rtp,
      itemsCount: Number(itemsCount),
      opened: Number(opened),
    };
  }

  async getCase(id: string): Promise<AdminCaseDetailDto> {
    const [r] = await this.db
      .select({ c: cases, categoryCode: caseCategories.code })
      .from(cases)
      .innerJoin(caseCategories, eq(caseCategories.id, cases.categoryId))
      .where(eq(cases.id, id));
    if (!r) throw notFound('CASE_NOT_FOUND');
    const [rev] = r.c.currentRevisionId
      ? await this.db
          .select()
          .from(caseRevisions)
          .where(eq(caseRevisions.id, r.c.currentRevisionId))
      : [];
    const contents = rev?.contents ?? [];
    const itemMap = await this.catalog.getItemsByIds(contents.map((e) => e.itemId));
    const [[opened]] = await Promise.all([
      this.db.select({ n: count() }).from(caseOpenings).where(eq(caseOpenings.caseId, id)),
    ]);
    return {
      ...this.toRow(
        r.c,
        r.categoryCode,
        contents.length,
        opened?.n ?? 0,
        await this.currentRtp(r.c),
      ),
      description: r.c.description ? localize(r.c.description) : null,
      availableFrom: r.c.availableFrom?.toISOString() ?? null,
      availableUntil: r.c.availableUntil?.toISOString() ?? null,
      contents: contents
        .map((e) => ({ item: itemMap.get(e.itemId), odds: e.odds }))
        .filter((x): x is { item: NonNullable<typeof x.item>; odds: number } => Boolean(x.item))
        .sort((a, b) => b.item.price - a.item.price),
      revision: rev
        ? { id: rev.id, version: rev.version, createdAt: rev.createdAt.toISOString() }
        : null,
    };
  }

  private caseValues(game: GameRow, body: AdminCaseBody) {
    return {
      gameId: game.id,
      slug: body.slug,
      name: { ru: body.name },
      description: body.description ? { ru: body.description } : null,
      imageUrl: body.imageUrl || null,
      accentColor: body.accentColor,
      price: body.kind === 'free' ? 0 : body.price,
      kind: body.kind,
      categoryId: body.categoryId,
      minLevel: body.minLevel ?? null,
      cooldownSeconds: body.cooldownSeconds ?? null,
      supplyTotal: body.supplyTotal ?? null,
      availableFrom: body.availableFrom ? new Date(body.availableFrom) : null,
      availableUntil: body.availableUntil ? new Date(body.availableUntil) : null,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    };
  }

  async createCase(
    actorId: string,
    game: GameRow,
    body: AdminCaseBody,
    ip: string | null,
  ): Promise<string> {
    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(cases).values({ id, ...this.caseValues(game, body), isActive: false });
        await this.audit.log(
          { actorId, action: 'case.create', entityType: 'case', entityId: id, after: body, ip },
          tx,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', 409, { field: 'slug' });
      throw err;
    }
    return id;
  }

  async updateCase(
    actorId: string,
    id: string,
    game: GameRow,
    body: AdminCaseBody,
    ip: string | null,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const [before] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
        if (!before) throw notFound('CASE_NOT_FOUND');
        if (body.isActive && !before.currentRevisionId) {
          throw new AppError('VALIDATION_ERROR', 400, { reason: 'no_contents' });
        }
        await tx
          .update(cases)
          .set({ ...this.caseValues(game, body), updatedAt: sql`now()` })
          .where(eq(cases.id, id));
        await this.audit.log(
          {
            actorId,
            action: 'case.update',
            entityType: 'case',
            entityId: id,
            before,
            after: body,
            ip,
          },
          tx,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', 409, { field: 'slug' });
      throw err;
    }
  }

  /**
   * Новый состав кейса: сумма шансов ровно 100 % (10 000 000 единиц). Создаётся неизменяемая ревизия —
   * старые открытия по-прежнему проверяются по своей ревизии.
   */
  async setContents(
    actorId: string,
    id: string,
    body: AdminCaseContentsBody,
    ip: string | null,
  ): Promise<void> {
    const v = validateOdds(body.contents);
    if (!v.ok) throw new AppError('VALIDATION_ERROR', 400, { reason: 'odds_sum', sum: v.sum });
    const ids = body.contents.map((e) => e.itemId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('VALIDATION_ERROR', 400, { reason: 'duplicate_items' });
    }
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
      if (!c) throw notFound('CASE_NOT_FOUND');
      const found = await tx
        .select({ id: items.id, price: items.price })
        .from(items)
        .where(and(inArray(items.id, ids), eq(items.gameId, c.gameId)));
      if (found.length !== ids.length) {
        throw new AppError('VALIDATION_ERROR', 400, { reason: 'items_game' });
      }
      const prices = new Map(found.map((f) => [f.id, f.price]));
      const rtp = caseRtp(
        body.contents.map((e) => ({ odds: e.odds, price: prices.get(e.itemId) ?? 0 })),
        c.price,
      );
      const [last] = await tx
        .select({ version: caseRevisions.version })
        .from(caseRevisions)
        .where(eq(caseRevisions.caseId, id))
        .orderBy(desc(caseRevisions.version))
        .limit(1);
      const revisionId = newId();
      await tx.insert(caseRevisions).values({
        id: revisionId,
        caseId: id,
        version: (last?.version ?? 0) + 1,
        contents: body.contents,
        price: c.price,
        rtp: rtp !== null ? rtp.toFixed(6) : null,
        createdBy: actorId,
      });
      await tx.delete(caseItems).where(eq(caseItems.caseId, id));
      await tx.insert(caseItems).values(
        body.contents.map((e, i) => ({
          caseId: id,
          itemId: e.itemId,
          odds: e.odds,
          sortOrder: i,
        })),
      );
      await tx
        .update(cases)
        .set({ currentRevisionId: revisionId, updatedAt: sql`now()` })
        .where(eq(cases.id, id));
      await this.audit.log(
        {
          actorId,
          action: 'case.contents',
          entityType: 'case',
          entityId: id,
          after: { revisionId, items: body.contents.length, rtp },
          ip,
        },
        tx,
      );
    });
  }

  // ---------- Предметы ----------

  async items(game: GameRow, q: AdminItemsQuery): Promise<AdminPageDto<AdminItemDto>> {
    const where: SQL[] = [eq(items.gameId, game.id)];
    if (q.q) {
      const term = `%${q.q.replace(/[%_]/g, '\\$&')}%`;
      where.push(or(ilike(items.fullName, term), ilike(items.marketName, term))!);
    }
    if (q.rarity) where.push(eq(rarities.code, q.rarity));
    if (q.active) where.push(eq(items.isActive, q.active === '1'));
    const cond = and(...where);
    const base = this.db
      .select({
        ...itemColumns,
        marketName: items.marketName,
        isActive: items.isActive,
        inUpgrade: items.inUpgrade,
        inContract: items.inContract,
        priceUpdatedAt: items.priceUpdatedAt,
      })
      .from(items)
      .innerJoin(rarities, eq(rarities.id, items.rarityId))
      .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
      .leftJoin(itemModels, eq(itemModels.id, items.modelId));
    const [rows, [agg]] = await Promise.all([
      base
        .where(cond)
        .orderBy(desc(items.price))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: count() })
        .from(items)
        .innerJoin(rarities, eq(rarities.id, items.rarityId))
        .where(cond),
    ]);
    return {
      items: rows.map((r) => ({
        ...toItemDto(r as unknown as ItemRow),
        marketName: r.marketName,
        isActive: r.isActive,
        inUpgrade: r.inUpgrade,
        inContract: r.inContract,
        priceUpdatedAt: r.priceUpdatedAt?.toISOString() ?? null,
      })),
      total: agg?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async patchItem(
    actorId: string,
    id: string,
    body: AdminItemPatchBody,
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(items).where(eq(items.id, id)).for('update');
      if (!before) throw notFound('ITEM_NOT_FOUND');
      const set: Partial<typeof items.$inferInsert> = { ...body };
      if (body.price !== undefined && body.price !== before.price) {
        set.priceUpdatedAt = new Date();
        await tx
          .insert(itemPriceHistory)
          .values({ itemId: id, price: body.price, source: 'admin', actorId });
      }
      await tx
        .update(items)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(items.id, id));
      await this.audit.log(
        {
          actorId,
          action: 'item.update',
          entityType: 'item',
          entityId: id,
          before: {
            price: before.price,
            isActive: before.isActive,
            isWithdrawable: before.isWithdrawable,
            inUpgrade: before.inUpgrade,
            inContract: before.inContract,
          },
          after: body,
          ip,
        },
        tx,
      );
    });
  }

  /** Массовое изменение цен по фильтру: на процент или фиксированная цена. */
  async bulkPrice(
    actorId: string,
    game: GameRow,
    body: AdminBulkPriceBody,
    ip: string | null,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const where: SQL[] = [eq(items.gameId, game.id)];
      if (body.q) {
        const term = `%${body.q.replace(/[%_]/g, '\\$&')}%`;
        where.push(or(ilike(items.fullName, term), ilike(items.marketName, term))!);
      }
      if (body.rarity) {
        where.push(
          sql`${items.rarityId} in (select id from rarities where game_id = ${game.id} and code = ${body.rarity})`,
        );
      }
      const newPrice =
        body.mode === 'percent'
          ? sql`greatest(1, round(${items.price} * ${1 + body.value / 100}))::bigint`
          : sql`${Math.max(1, Math.round(body.value))}::bigint`;
      const updated = await tx
        .update(items)
        .set({ price: newPrice, priceUpdatedAt: new Date(), updatedAt: sql`now()` })
        .where(and(...where))
        .returning({ id: items.id, price: items.price });
      if (updated.length) {
        await tx
          .insert(itemPriceHistory)
          .values(
            updated.map((u) => ({ itemId: u.id, price: u.price, source: 'admin_bulk', actorId })),
          );
      }
      await this.audit.log(
        {
          actorId,
          action: 'item.bulk_price',
          entityType: 'item',
          entityId: null,
          after: { ...body, game: game.code, count: updated.length },
          ip,
        },
        tx,
      );
      return updated.length;
    });
  }

  // ---------- Редкости ----------

  async rarities(game: GameRow): Promise<AdminRarityDto[]> {
    const rows = await this.db
      .select()
      .from(rarities)
      .where(eq(rarities.gameId, game.id))
      .orderBy(asc(rarities.sortOrder));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: localize(r.name),
      color: r.color,
      sortOrder: r.sortOrder,
    }));
  }

  async patchRarity(
    actorId: string,
    id: number,
    body: { name?: string; color?: string; sortOrder?: number },
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(rarities).where(eq(rarities.id, id)).for('update');
      if (!before) throw notFound();
      await tx
        .update(rarities)
        .set({
          ...(body.name !== undefined ? { name: { ...before.name, ru: body.name } } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        })
        .where(eq(rarities.id, id));
      await this.audit.log(
        {
          actorId,
          action: 'rarity.update',
          entityType: 'rarity',
          entityId: String(id),
          before,
          after: body,
          ip,
        },
        tx,
      );
    });
  }
}
