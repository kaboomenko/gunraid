import { Inject, Injectable } from '@nestjs/common';
import {
  inventoryEvents,
  itemModels,
  itemTypes,
  items,
  newId,
  rarities,
  userItems,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import type {
  InventoryPageDto,
  InventoryQuery,
  ItemSource,
  SellBody,
  SellResultDto,
  UserItemDto,
  UserItemStatus,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { itemColumns, toItemDto, type ItemRow } from '../catalog/item-mapper.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';

const userItemColumns = {
  ...itemColumns,
  userItemId: userItems.id,
  status: userItems.status,
  sourceType: userItems.sourceType,
  acquiredValue: userItems.acquiredValue,
  acquiredAt: userItems.acquiredAt,
  soldValue: userItems.soldValue,
};

type UserItemRow = ItemRow & {
  userItemId: string;
  status: UserItemStatus;
  sourceType: ItemSource;
  acquiredValue: number;
  acquiredAt: Date;
  soldValue: number | null;
};

export function toUserItemDto(row: UserItemRow): UserItemDto {
  return {
    id: row.userItemId,
    status: row.status,
    source: row.sourceType,
    acquiredValue: row.acquiredValue,
    acquiredAt: row.acquiredAt.toISOString(),
    soldValue: row.soldValue,
    item: toItemDto(row),
  };
}

export interface GrantInput {
  userId: string;
  gameId: number;
  itemId: string;
  value: number;
  sourceType: ItemSource;
  sourceId?: string | null;
}

export interface LockedUserItem {
  id: string;
  itemId: string;
  price: number;
  isWithdrawable: boolean;
}

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  userItemsQuery(tx: DbOrTx = this.db) {
    return tx
      .select(userItemColumns)
      .from(userItems)
      .innerJoin(items, eq(items.id, userItems.itemId))
      .innerJoin(rarities, eq(rarities.id, items.rarityId))
      .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
      .leftJoin(itemModels, eq(itemModels.id, items.modelId));
  }

  async list(userId: string, gameId: number, q: InventoryQuery): Promise<InventoryPageDto> {
    const where: SQL[] = [eq(userItems.userId, userId), eq(userItems.gameId, gameId)];
    if (q.status === 'in_inventory') where.push(eq(userItems.status, 'in_inventory'));
    const cond = and(...where);
    const order =
      q.sort === 'date_asc'
        ? [asc(userItems.acquiredAt)]
        : q.sort === 'price_desc'
          ? [desc(items.price), desc(userItems.acquiredAt)]
          : q.sort === 'price_asc'
            ? [asc(items.price), desc(userItems.acquiredAt)]
            : q.sort === 'rarity_desc'
              ? [desc(rarities.sortOrder), desc(items.price)]
              : [desc(userItems.acquiredAt), desc(userItems.id)];
    const [rows, [agg]] = await Promise.all([
      this.userItemsQuery()
        .where(cond)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({
          total: count(),
          totalValue: sql<number>`coalesce(sum(${items.price}) filter (where ${userItems.status} = 'in_inventory'), 0)::bigint`,
        })
        .from(userItems)
        .innerJoin(items, eq(items.id, userItems.itemId))
        .where(cond),
    ]);
    return {
      items: (rows as UserItemRow[]).map(toUserItemDto),
      total: agg?.total ?? 0,
      totalValue: Number(agg?.totalValue ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async getUserItems(ids: string[], tx: DbOrTx = this.db): Promise<UserItemDto[]> {
    if (!ids.length) return [];
    const rows = await this.userItemsQuery(tx).where(inArray(userItems.id, ids));
    return (rows as UserItemRow[]).map(toUserItemDto);
  }

  /** Выдать предмет пользователю (кейс, апгрейд, контракт, баттл, бонусы). */
  async grant(tx: DbOrTx, input: GrantInput): Promise<string> {
    const id = newId();
    await tx.insert(userItems).values({
      id,
      userId: input.userId,
      gameId: input.gameId,
      itemId: input.itemId,
      acquiredValue: input.value,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
    });
    await tx.insert(inventoryEvents).values({
      userItemId: id,
      userId: input.userId,
      type: 'acquired',
      value: input.value,
      refType: input.sourceType,
      refId: input.sourceId ?? null,
    });
    return id;
  }

  /**
   * Блокирует предметы пользователя в инвентаре (FOR UPDATE, по возрастанию id).
   * Если хоть один недоступен (продан, на выводе, чужой, другая игра) — ITEM_NOT_AVAILABLE.
   */
  async lockAvailable(tx: DbOrTx, userId: string, gameId: number, ids: string[]): Promise<LockedUserItem[]> {
    const unique = [...new Set(ids)].sort();
    if (unique.length !== ids.length) throw new AppError('ITEM_NOT_AVAILABLE', 409, { reason: 'duplicates' });
    const rows = await tx
      .select({ id: userItems.id, itemId: userItems.itemId, price: items.price, isWithdrawable: items.isWithdrawable })
      .from(userItems)
      .innerJoin(items, eq(items.id, userItems.itemId))
      .where(
        and(
          inArray(userItems.id, unique),
          eq(userItems.userId, userId),
          eq(userItems.gameId, gameId),
          eq(userItems.status, 'in_inventory'),
        ),
      )
      .orderBy(asc(userItems.id))
      .for('update', { of: userItems });
    if (rows.length !== unique.length) {
      const found = new Set(rows.map((r) => r.id));
      throw new AppError('ITEM_NOT_AVAILABLE', 409, { missing: unique.filter((id) => !found.has(id)) });
    }
    return rows;
  }

  /** Перевести заблокированные предметы в новый статус с записью в журнал. */
  async consume(
    tx: DbOrTx,
    userId: string,
    locked: LockedUserItem[],
    status: Exclude<UserItemStatus, 'in_inventory'>,
    refType: string,
    refId: string,
    values?: Map<string, number>,
  ): Promise<void> {
    if (!locked.length) return;
    for (const it of locked) {
      const value = values?.get(it.id) ?? it.price;
      await tx
        .update(userItems)
        .set({
          status,
          statusChangedAt: sql`now()`,
          consumedRefType: refType,
          consumedRefId: refId,
          soldValue: status === 'sold' ? value : null,
        })
        .where(eq(userItems.id, it.id));
      await tx.insert(inventoryEvents).values({ userItemId: it.id, userId, type: status, value, refType, refId });
    }
  }

  /** Продажа одного, выбранных или всех предметов за гемы (по текущей цене × коэффициент продажи). */
  async sell(tx: DbOrTx, userId: string, gameId: number, body: SellBody): Promise<SellResultDto> {
    await this.ledger.lockWallet(tx, userId);
    let ids: string[];
    if ('all' in body) {
      const rows = await tx
        .select({ id: userItems.id })
        .from(userItems)
        .where(and(eq(userItems.userId, userId), eq(userItems.gameId, gameId), eq(userItems.status, 'in_inventory')));
      ids = rows.map((r) => r.id);
      if (!ids.length) throw new AppError('NOTHING_TO_SELL', 400);
    } else {
      ids = body.userItemIds;
    }
    const locked = await this.lockAvailable(tx, userId, gameId, ids);
    const { rate } = await this.settings.get('sell');
    const values = new Map(locked.map((it) => [it.id, Math.floor(it.price * rate)]));
    const total = [...values.values()].reduce((a, b) => a + b, 0);
    const saleId = newId();
    await this.consume(tx, userId, locked, 'sold', 'sale', saleId, values);
    let balance = await this.ledger.balanceOf(userId, tx);
    if (total > 0) {
      const res = await this.ledger.post(tx, {
        userId,
        type: 'item_sell',
        amount: total,
        refType: 'sale',
        refId: saleId,
        idempotencyKey: `sale:${saleId}`,
        meta: { count: locked.length, gameId },
      });
      balance = res.balanceAfter;
    }
    return { soldCount: locked.length, total, balance, soldIds: locked.map((l) => l.id) };
  }
}
