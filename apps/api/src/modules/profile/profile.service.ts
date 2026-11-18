import { Inject, Injectable } from '@nestjs/common';
import { caseOpenings, contracts, deposits, ledgerEntries, upgrades, userItems, users, type Db } from '@gunraid/db';
import type {
  PageDto,
  ProfileStatsDto,
  PublicProfileStatsDto,
  TransactionDto,
  UserItemDto,
} from '@gunraid/shared';
import { and, count, desc, eq, lt, ne, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { notFound } from '../../common/app-error.js';
import { InventoryService, toUserItemDto } from '../inventory/inventory.service.js';

/** Статистика и история профиля. Счётчики режимов наполняются по мере появления режимов. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly inventory: InventoryService,
  ) {}

  /** Хуки для режимов следующих этапов (кейсы, апгрейды, контракты, баттлы). */
  protected async modeCounters(userId: string, gameId: number) {
    const [[cases], [ups], [cts]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(caseOpenings)
        .where(and(eq(caseOpenings.userId, userId), eq(caseOpenings.gameId, gameId))),
      this.db
        .select({ value: count() })
        .from(upgrades)
        .where(and(eq(upgrades.userId, userId), eq(upgrades.gameId, gameId), eq(upgrades.isWin, true))),
      this.db
        .select({ value: count() })
        .from(contracts)
        .where(and(eq(contracts.userId, userId), eq(contracts.gameId, gameId))),
    ]);
    return {
      casesOpened: cases?.value ?? 0,
      upgradesWon: ups?.value ?? 0,
      contractsDone: cts?.value ?? 0,
      battlesWon: 0,
    };
  }

  async bestDrop(userId: string, gameId: number): Promise<UserItemDto | null> {
    const [row] = await this.inventory
      .userItemsQuery()
      .where(and(eq(userItems.userId, userId), eq(userItems.gameId, gameId), ne(userItems.sourceType, 'seed')))
      .orderBy(desc(userItems.acquiredValue))
      .limit(1);
    return row ? toUserItemDto(row as Parameters<typeof toUserItemDto>[0]) : null;
  }

  async stats(userId: string, gameId: number): Promise<ProfileStatsDto> {
    const [counters, [dep], best] = await Promise.all([
      this.modeCounters(userId, gameId),
      this.db
        .select({ total: sql<number>`coalesce(sum(${deposits.gemsAmount}), 0)::bigint` })
        .from(deposits)
        .where(and(eq(deposits.userId, userId), eq(deposits.status, 'succeeded'))),
      this.bestDrop(userId, gameId),
    ]);
    return { ...counters, depositsTotal: Number(dep?.total ?? 0), bestDrop: best };
  }

  async publicStats(shortId: number, gameId: number): Promise<PublicProfileStatsDto> {
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.shortId, shortId)).limit(1);
    if (!user) throw notFound();
    const recent = await this.inventory
      .userItemsQuery()
      .where(and(eq(userItems.userId, user.id), eq(userItems.gameId, gameId), ne(userItems.sourceType, 'seed')))
      .orderBy(desc(userItems.acquiredAt))
      .limit(12);
    return {
      bestDrop: await this.bestDrop(user.id, gameId),
      recentDrops: recent.map((r) => toUserItemDto(r as Parameters<typeof toUserItemDto>[0])),
    };
  }

  async transactions(userId: string, cursor: number | undefined, limit = 30): Promise<PageDto<TransactionDto>> {
    const where = cursor ? and(eq(ledgerEntries.userId, userId), lt(ledgerEntries.id, cursor)) : eq(ledgerEntries.userId, userId);
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(where)
      .orderBy(desc(ledgerEntries.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        refType: r.refType,
        refId: r.refId,
        meta: r.meta,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? String(page[page.length - 1]?.id) : null,
    };
  }

  async drops(userId: string, gameId: number, cursor: string | undefined, limit = 30): Promise<PageDto<UserItemDto>> {
    const base = and(eq(userItems.userId, userId), eq(userItems.gameId, gameId));
    const where = cursor ? and(base, lt(userItems.acquiredAt, new Date(cursor))) : base;
    const rows = await this.inventory
      .userItemsQuery()
      .where(where)
      .orderBy(desc(userItems.acquiredAt), desc(userItems.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit).map((r) => toUserItemDto(r as Parameters<typeof toUserItemDto>[0]));
    return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1]?.acquiredAt ?? null) : null };
  }
}
