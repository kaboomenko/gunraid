import { Inject, Injectable } from '@nestjs/common';
import {
  banners,
  caseCategories,
  caseOpenings,
  caseRevisions,
  cases,
  newId,
  userCooldowns,
  users,
  type Db,
  type DbOrTx,
  type RevisionEntry,
} from '@gunraid/db';
import { oddsToPercent, pickByTicket, rollFloat, ticketFromFloat } from '@gunraid/game-core';
import type {
  BannerDto,
  CaseAvailabilityDto,
  CaseCardDto,
  CaseDetailDto,
  CaseOpenResultDto,
  CaseOpeningProofDto,
  HomeDto,
} from '@gunraid/shared';
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { localize } from '../catalog/item-mapper.js';
import { FairnessService } from '../fairness/fairness.service.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

type CaseRow = typeof cases.$inferSelect;
export const MAX_OPEN_COUNT = 5;

export interface UserCaseContext {
  userId: string;
  adultConfirmed: boolean;
}

@Injectable()
export class CasesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  private toCard(row: CaseRow, categoryCode: string): CaseCardDto {
    return {
      id: row.id,
      slug: row.slug,
      name: localize(row.name),
      imageUrl: row.imageUrl,
      accentColor: row.accentColor,
      price: row.price,
      kind: row.kind,
      minLevel: row.minLevel,
      cooldownSeconds: row.cooldownSeconds,
      supplyTotal: row.supplyTotal,
      supplyUsed: row.supplyUsed,
      categoryCode,
    };
  }

  private visibleNow() {
    return and(
      eq(cases.isActive, true),
      or(isNull(cases.availableFrom), lte(cases.availableFrom, sql`now()`)),
      or(isNull(cases.availableUntil), gt(cases.availableUntil, sql`now()`)),
    );
  }

  async home(game: GameRow): Promise<HomeDto> {
    const [cats, rows, bannerRows] = await Promise.all([
      this.db.select().from(caseCategories).where(eq(caseCategories.gameId, game.id)).orderBy(asc(caseCategories.sortOrder)),
      this.db
        .select()
        .from(cases)
        .where(and(eq(cases.gameId, game.id), this.visibleNow()))
        .orderBy(asc(cases.sortOrder)),
      this.db
        .select()
        .from(banners)
        .where(
          and(
            or(eq(banners.gameId, game.id), isNull(banners.gameId)),
            eq(banners.isActive, true),
            or(isNull(banners.startsAt), lte(banners.startsAt, sql`now()`)),
            or(isNull(banners.endsAt), gt(banners.endsAt, sql`now()`)),
          ),
        )
        .orderBy(asc(banners.sortOrder)),
    ]);
    return {
      categories: cats
        .map((c) => ({
          code: c.code,
          name: localize(c.name),
          cases: rows.filter((r) => r.categoryId === c.id).map((r) => this.toCard(r, c.code)),
        }))
        .filter((c) => c.cases.length > 0),
      banners: bannerRows.map(
        (b): BannerDto => ({
          id: b.id,
          title: localize(b.title),
          subtitle: b.subtitle ? localize(b.subtitle) : null,
          imageUrl: b.imageUrl,
          link: b.link,
          accentColor: b.accentColor,
        }),
      ),
    };
  }

  private async findCase(game: GameRow, slug: string, tx: DbOrTx = this.db) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw notFound('CASE_NOT_FOUND');
    const [row] = await tx
      .select({ c: cases, categoryCode: caseCategories.code })
      .from(cases)
      .innerJoin(caseCategories, eq(caseCategories.id, cases.categoryId))
      .where(and(eq(cases.gameId, game.id), eq(cases.slug, slug)))
      .limit(1);
    if (!row || !row.c.isActive || !row.c.currentRevisionId) throw notFound('CASE_NOT_FOUND');
    return row;
  }

  private isAvailableNow(c: CaseRow): boolean {
    const now = Date.now();
    return (
      c.isActive &&
      (!c.availableFrom || c.availableFrom.getTime() <= now) &&
      (!c.availableUntil || c.availableUntil.getTime() > now)
    );
  }

  async availability(c: CaseRow, ctx: UserCaseContext | null): Promise<CaseAvailabilityDto> {
    const block = (reason: CaseAvailabilityDto['reason'], extra: Partial<CaseAvailabilityDto> = {}) => ({
      canOpen: false,
      reason,
      availableAt: null,
      levelRequired: null,
      ...extra,
    });
    if (!this.isAvailableNow(c)) return block('UNAVAILABLE');
    if (c.supplyTotal !== null && c.supplyUsed >= c.supplyTotal) return block('SOLD_OUT');
    if (!ctx) return block('LOGIN', { levelRequired: c.minLevel });
    if (!ctx.adultConfirmed) return block('ADULT');
    if (c.minLevel) {
      const [u] = await this.db.select({ level: users.level }).from(users).where(eq(users.id, ctx.userId));
      if ((u?.level ?? 0) < c.minLevel) return block('LEVEL', { levelRequired: c.minLevel });
    }
    if (c.cooldownSeconds) {
      const [cd] = await this.db
        .select({ availableAt: userCooldowns.availableAt })
        .from(userCooldowns)
        .where(and(eq(userCooldowns.userId, ctx.userId), eq(userCooldowns.key, `free_case:${c.id}`)));
      if (cd && cd.availableAt.getTime() > Date.now()) {
        return block('COOLDOWN', { availableAt: cd.availableAt.toISOString() });
      }
    }
    return { canOpen: true, reason: null, availableAt: null, levelRequired: c.minLevel };
  }

  private async revision(revisionId: string, tx: DbOrTx = this.db) {
    const [rev] = await tx.select().from(caseRevisions).where(eq(caseRevisions.id, revisionId));
    if (!rev) throw notFound('CASE_NOT_FOUND');
    return rev;
  }

  async detail(game: GameRow, slug: string, ctx: UserCaseContext | null): Promise<CaseDetailDto> {
    const { c, categoryCode } = await this.findCase(game, slug);
    const rev = await this.revision(c.currentRevisionId as string);
    const itemMap = await this.catalog.getItemsByIds(rev.contents.map((e) => e.itemId));
    const items = rev.contents
      .map((e) => {
        const item = itemMap.get(e.itemId);
        return item ? { item, odds: e.odds, chance: oddsToPercent(e.odds) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.item.price - a.item.price);
    return {
      ...this.toCard(c, categoryCode),
      description: c.description ? localize(c.description) : null,
      revisionId: rev.id,
      items,
      availability: await this.availability(c, ctx),
      maxOpenCount: c.kind === 'free' ? 1 : MAX_OPEN_COUNT,
    };
  }

  /**
   * Открытие x1–x5 в одной транзакции. Порядок блокировок: кошелёк → кулдаун → тираж кейса → пара сидов.
   * Результат каждого открытия — provably fair по (server seed, client seed, nonce).
   */
  async open(tx: DbOrTx, userId: string, game: GameRow, slug: string, count: number): Promise<CaseOpenResultDto> {
    const { c } = await this.findCase(game, slug, tx);
    if (!this.isAvailableNow(c)) throw new AppError('CASE_UNAVAILABLE', 409);
    const isFree = c.kind === 'free';
    if (count < 1 || count > (isFree ? 1 : MAX_OPEN_COUNT)) throw new AppError('CASE_OPEN_COUNT_INVALID', 400);
    const rev = await this.revision(c.currentRevisionId as string, tx);
    const batchId = newId();

    if (c.minLevel) {
      const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
      if ((u?.level ?? 0) < c.minLevel) throw new AppError('CASE_LEVEL_REQUIRED', 403, { level: c.minLevel });
    }

    let balance: number;
    if (!isFree) {
      const charged = await this.ledger.post(tx, {
        userId,
        type: 'case_open',
        amount: -(c.price * count),
        refType: 'case_batch',
        refId: batchId,
        idempotencyKey: `case:${batchId}`,
        meta: { caseId: c.id, count, game: game.code },
      });
      balance = charged.balanceAfter;
    } else {
      balance = await this.ledger.balanceOf(userId, tx);
    }

    let cooldownUntil: string | null = null;
    if (c.cooldownSeconds) {
      const key = `free_case:${c.id}`;
      await tx
        .insert(userCooldowns)
        .values({ userId, key, availableAt: new Date(0) })
        .onConflictDoNothing();
      const [cd] = await tx
        .select()
        .from(userCooldowns)
        .where(and(eq(userCooldowns.userId, userId), eq(userCooldowns.key, key)))
        .for('update');
      if (cd && cd.availableAt.getTime() > Date.now()) {
        throw new AppError('CASE_COOLDOWN', 409, { availableAt: cd.availableAt.toISOString() });
      }
      const next = new Date(Date.now() + c.cooldownSeconds * 1000);
      await tx
        .update(userCooldowns)
        .set({ availableAt: next })
        .where(and(eq(userCooldowns.userId, userId), eq(userCooldowns.key, key)));
      cooldownUntil = next.toISOString();
    }

    let supplyUsed: number | null = null;
    if (c.supplyTotal !== null) {
      const [row] = await tx
        .update(cases)
        .set({ supplyUsed: sql`${cases.supplyUsed} + ${count}` })
        .where(and(eq(cases.id, c.id), sql`${cases.supplyUsed} + ${count} <= ${cases.supplyTotal}`))
        .returning({ supplyUsed: cases.supplyUsed });
      if (!row) throw new AppError('CASE_SOLD_OUT', 409);
      supplyUsed = row.supplyUsed;
    }

    const rolls = await this.fairness.reserve(tx, userId, count);
    const itemMap = await this.catalog.getItemsByIds(rev.contents.map((e) => e.itemId), tx);
    const results: CaseOpenResultDto['results'] = [];
    for (const nonce of rolls.nonces) {
      const ticket = ticketFromFloat(rollFloat(rolls.serverSeed, rolls.clientSeed, nonce));
      const entry = pickByTicket<RevisionEntry>(rev.contents, ticket);
      const item = itemMap.get(entry.itemId);
      if (!item) throw new Error(`case item ${entry.itemId} missing`);
      const openingId = newId();
      const userItemId = await this.inventory.grant(tx, {
        userId,
        gameId: game.id,
        itemId: item.id,
        value: item.price,
        sourceType: 'case',
        sourceId: openingId,
      });
      await tx.insert(caseOpenings).values({
        id: openingId,
        userId,
        gameId: game.id,
        caseId: c.id,
        revisionId: rev.id,
        batchId,
        pricePaid: c.price,
        isFree,
        fairSeedId: rolls.seedId,
        nonce,
        ticket,
        itemId: item.id,
        itemValue: item.price,
        userItemId,
      });
      results.push({ openingId, userItemId, item, nonce, ticket });
    }

    const { delayMs } = await this.settings.get('feed');
    await this.outbox.add(
      tx,
      'case.opened',
      {
        game: game.code,
        source: 'case',
        userId,
        caseSlug: c.slug,
        caseName: localize(c.name),
        caseImage: c.imageUrl,
        drops: results.map((r) => ({
          id: r.openingId,
          itemId: r.item.id,
          skinName: r.item.skinName,
          modelName: r.item.modelName,
          imageUrl: r.item.imageUrl,
          rarityColor: r.item.rarity.color,
          price: r.item.price,
        })),
        createdAt: new Date().toISOString(),
      },
      delayMs,
    );

    return {
      batchId,
      caseId: c.id,
      balance,
      results,
      fair: { serverSeedHash: rolls.serverSeedHash, clientSeed: rolls.clientSeed },
      supplyUsed,
      supplyTotal: c.supplyTotal,
      cooldownUntil,
    };
  }

  async proof(openingId: string): Promise<CaseOpeningProofDto> {
    const [o] = await this.db.select().from(caseOpenings).where(eq(caseOpenings.id, openingId));
    if (!o) throw notFound();
    const [seed, rev, [c]] = await Promise.all([
      this.fairness.getSeed(o.fairSeedId),
      this.revision(o.revisionId),
      this.db.select({ name: cases.name }).from(cases).where(eq(cases.id, o.caseId)),
    ]);
    if (!seed) throw notFound();
    const itemMap = await this.catalog.getItemsByIds(rev.contents.map((e) => e.itemId));
    const revealed = seed.status === 'revealed';
    return {
      type: 'case_opening',
      id: o.id,
      revealed,
      serverSeed: revealed ? this.fairness.decrypt(seed.serverSeedEnc) : null,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: o.nonce,
      ticket: o.ticket,
      itemId: o.itemId,
      caseName: c ? localize(c.name) : '',
      contents: rev.contents.map((e) => ({
        itemId: e.itemId,
        odds: e.odds,
        name: itemMap.get(e.itemId)?.fullName ?? e.itemId,
        price: itemMap.get(e.itemId)?.price ?? 0,
      })),
      createdAt: o.createdAt.toISOString(),
    };
  }
}
