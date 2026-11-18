import { Inject, Injectable } from '@nestjs/common';
import {
  cases,
  deposits,
  games,
  items,
  newId,
  promoActivations,
  promoCodes,
  users,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import type { PromoActivateBody, PromoActivateResultDto } from '@gunraid/shared';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { localize } from '../catalog/item-mapper.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EntitlementsService } from './entitlements.service.js';

export interface PromoContext {
  ip: string | null;
  deviceId: string | null;
}

/**
 * Промокоды. Порядок блокировок: кошелёк → строка промокода (лимит активаций проверяется под блокировкой,
 * поэтому общий лимит не превышается при параллельных активациях).
 */
@Injectable()
export class PromoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async activate(
    tx: DbOrTx,
    userId: string,
    body: PromoActivateBody,
    ctx: PromoContext,
  ): Promise<PromoActivateResultDto> {
    await this.ledger.lockWallet(tx, userId);
    const code = body.code.trim().toUpperCase();
    const [p] = await tx
      .select()
      .from(promoCodes)
      .where(sql`upper(${promoCodes.code}) = ${code}`)
      .for('update');
    if (!p || !p.isActive) throw new AppError('PROMO_NOT_FOUND', 404);
    const now = Date.now();
    if (
      (p.startsAt && p.startsAt.getTime() > now) ||
      (p.expiresAt && p.expiresAt.getTime() <= now)
    ) {
      throw new AppError('PROMO_EXPIRED', 410);
    }
    if (p.totalLimit !== null && p.activationsCount >= p.totalLimit) {
      throw new AppError('PROMO_LIMIT_REACHED', 409);
    }
    const [mine] = await tx
      .select({ n: count() })
      .from(promoActivations)
      .where(and(eq(promoActivations.promoId, p.id), eq(promoActivations.userId, userId)));
    if ((mine?.n ?? 0) >= p.perUserLimit) throw new AppError('PROMO_ALREADY_USED', 409);

    let gameCode: string | null = null;
    if (p.gameId !== null) {
      const [g] = await tx.select({ code: games.code }).from(games).where(eq(games.id, p.gameId));
      gameCode = g?.code ?? null;
      if (body.game && body.game !== gameCode) {
        throw new AppError('PROMO_WRONG_GAME', 409, { game: gameCode });
      }
    }
    if (p.newUsersMaxAgeHours !== null) {
      const [u] = await tx
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId));
      if (!u || u.createdAt.getTime() < now - p.newUsersMaxAgeHours * 3_600_000) {
        throw new AppError('PROMO_CONDITIONS_NOT_MET', 403, { reason: 'new_users' });
      }
    }
    if (p.minDepositGems !== null && p.minDepositGems > 0) {
      const where = [eq(deposits.userId, userId), eq(deposits.status, 'succeeded')];
      if (p.minDepositPeriodDays) {
        where.push(gte(deposits.completedAt, new Date(now - p.minDepositPeriodDays * 86_400_000)));
      }
      const [dep] = await tx
        .select({ sum: sql<number>`coalesce(sum(${deposits.gemsAmount}), 0)::bigint` })
        .from(deposits)
        .where(and(...where));
      if (Number(dep?.sum ?? 0) < p.minDepositGems) {
        throw new AppError('PROMO_CONDITIONS_NOT_MET', 403, {
          reason: 'deposit',
          minDepositGems: p.minDepositGems,
          periodDays: p.minDepositPeriodDays,
        });
      }
    }

    const activationId = newId();
    const result: PromoActivateResultDto = {
      code,
      type: p.type,
      amount: p.amount,
      percent: p.percent !== null ? Number(p.percent) : null,
      maxAmount: p.maxAmount,
      item: null,
      caseName: null,
      caseSlug: null,
      game: gameCode,
      balance: null,
    };
    let refType: string;
    let refId: string;
    switch (p.type) {
      case 'balance': {
        const res = await this.ledger.post(tx, {
          userId,
          type: 'promo_balance',
          amount: p.amount ?? 0,
          refType: 'promo_activation',
          refId: activationId,
          idempotencyKey: `promo:${activationId}`,
          meta: { code },
        });
        result.balance = res.balanceAfter;
        refType = 'ledger';
        refId = String(res.entryId);
        break;
      }
      case 'item': {
        const itemMap = await this.catalog.getItemsByIds([p.itemId as string], tx);
        const item = itemMap.get(p.itemId as string);
        if (!item) throw new AppError('PROMO_NOT_FOUND', 404);
        const [g] = await tx
          .select({ id: games.id, code: games.code })
          .from(items)
          .innerJoin(games, eq(games.id, items.gameId))
          .where(eq(items.id, item.id));
        refId = await this.inventory.grant(tx, {
          userId,
          gameId: g!.id,
          itemId: item.id,
          value: item.price,
          sourceType: 'promo',
          sourceId: activationId,
        });
        refType = 'user_item';
        result.item = item;
        result.game = g!.code;
        break;
      }
      default: {
        if (p.type === 'free_case' && p.caseId) {
          const [c] = await tx
            .select({ slug: cases.slug, name: cases.name, gameCode: games.code })
            .from(cases)
            .innerJoin(games, eq(games.id, cases.gameId))
            .where(eq(cases.id, p.caseId));
          result.caseName = c ? localize(c.name) : null;
          result.caseSlug = c?.slug ?? null;
          result.game = c?.gameCode ?? result.game;
        }
        refId = await this.entitlements.grant(tx, {
          userId,
          type:
            p.type === 'free_case'
              ? 'free_case'
              : p.type === 'wheel_spin'
                ? 'wheel_spin'
                : 'deposit_bonus',
          caseId: p.caseId,
          percent: p.percent !== null ? Number(p.percent) : null,
          maxAmount: p.maxAmount,
          sourceType: 'promo',
          sourceId: p.id,
        });
        refType = 'entitlement';
      }
    }
    await tx
      .update(promoCodes)
      .set({ activationsCount: sql`${promoCodes.activationsCount} + 1` })
      .where(eq(promoCodes.id, p.id));
    await tx.insert(promoActivations).values({
      id: activationId,
      promoId: p.id,
      userId,
      resultRefType: refType,
      resultRefId: refId,
      ip: ctx.ip,
      deviceId: ctx.deviceId,
    });
    return result;
  }
}
