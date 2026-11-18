import { Inject, Injectable } from '@nestjs/common';
import {
  itemModels,
  itemTypes,
  items,
  newId,
  rarities,
  upgradeStakeItems,
  upgrades,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import { chanceToScaled, rollFloat, rollToScaled, upgradeChance, upgradeWins } from '@gunraid/game-core';
import type {
  ItemsPageDto,
  UpgradeBody,
  UpgradeConfigDto,
  UpgradeHistoryDto,
  UpgradeProofDto,
  UpgradeResultDto,
  UpgradeTargetsQuery,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { itemColumns, toItemDto, type ItemRow } from '../catalog/item-mapper.js';
import { FairnessService } from '../fairness/fairness.service.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService, type LockedUserItem } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class UpgradeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  async config(): Promise<UpgradeConfigDto> {
    const s = await this.settings.get('upgrade');
    return { commission: s.commission, maxChance: s.maxChance, minChance: s.minChance, multipliers: s.multipliers };
  }

  /** Цели апгрейда: активные предметы игры с флагом in_upgrade. */
  async targets(game: GameRow, q: UpgradeTargetsQuery): Promise<ItemsPageDto> {
    const where: SQL[] = [eq(items.gameId, game.id), eq(items.isActive, true), eq(items.inUpgrade, true)];
    if (q.minPrice !== undefined) where.push(gte(items.price, q.minPrice));
    if (q.maxPrice !== undefined) where.push(lte(items.price, q.maxPrice));
    if (q.q) where.push(ilike(items.fullName, `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
    const cond = and(...where);
    const [rows, [agg]] = await Promise.all([
      this.db
        .select(itemColumns)
        .from(items)
        .innerJoin(rarities, eq(rarities.id, items.rarityId))
        .innerJoin(itemTypes, eq(itemTypes.id, items.typeId))
        .leftJoin(itemModels, eq(itemModels.id, items.modelId))
        .where(cond)
        .orderBy(q.sort === 'price_desc' ? desc(items.price) : asc(items.price), asc(items.fullName))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(items).where(cond),
    ]);
    return { items: (rows as ItemRow[]).map(toItemDto), total: agg?.total ?? 0, page: q.page, pageSize: q.pageSize };
  }

  /**
   * Апгрейд в одной транзакции: ставка (гемы через ledger или предметы → used_upgrade),
   * шанс = ставка / цена × (1 − комиссия) с потолком, бросок provably fair, выдача цели при победе.
   */
  async upgrade(tx: DbOrTx, userId: string, game: GameRow, body: UpgradeBody): Promise<UpgradeResultDto> {
    const s = await this.settings.get('upgrade');
    const [target] = await tx
      .select({ id: items.id, price: items.price })
      .from(items)
      .where(and(eq(items.id, body.targetItemId), eq(items.gameId, game.id), eq(items.isActive, true), eq(items.inUpgrade, true)));
    if (!target) throw new AppError('UPGRADE_TARGET_INVALID', 400);
    const upgradeId = newId();

    let stakeValue: number;
    let stakeAmount = 0;
    let locked: LockedUserItem[] = [];
    if ('amount' in body) {
      if (body.amount >= target.price) throw new AppError('UPGRADE_TARGET_INVALID', 400, { reason: 'target_not_more_expensive' });
      stakeAmount = body.amount;
      stakeValue = body.amount;
    } else {
      await this.ledger.lockWallet(tx, userId);
      locked = await this.inventory.lockAvailable(tx, userId, game.id, body.userItemIds);
      stakeValue = locked.reduce((sum, it) => sum + it.price, 0);
      if (stakeValue >= target.price) {
        throw new AppError('UPGRADE_TARGET_INVALID', 400, { reason: 'target_not_more_expensive' });
      }
    }
    if (stakeValue <= 0) throw new AppError('UPGRADE_STAKE_INVALID', 400);
    const chance = upgradeChance(stakeValue, target.price, s);
    if (chance < s.minChance) throw new AppError('UPGRADE_CHANCE_TOO_LOW', 400, { minChance: s.minChance });
    const chanceScaled = chanceToScaled(chance);

    if (stakeAmount > 0) {
      await this.ledger.post(tx, {
        userId,
        type: 'upgrade_stake',
        amount: -stakeAmount,
        refType: 'upgrade',
        refId: upgradeId,
        idempotencyKey: `upgrade:${upgradeId}`,
        meta: { targetItemId: target.id, game: game.code },
      });
    } else {
      await this.inventory.consume(tx, userId, locked, 'used_upgrade', 'upgrade', upgradeId);
    }

    const rolls = await this.fairness.reserve(tx, userId, 1);
    const nonce = rolls.nonces[0] as number;
    const roll = rollToScaled(rollFloat(rolls.serverSeed, rolls.clientSeed, nonce));
    const isWin = upgradeWins(roll, chanceScaled);
    const targetDto = await this.catalog.getItem(game.id, target.id, tx);

    let resultUserItemId: string | null = null;
    if (isWin) {
      resultUserItemId = await this.inventory.grant(tx, {
        userId,
        gameId: game.id,
        itemId: target.id,
        value: target.price,
        sourceType: 'upgrade',
        sourceId: upgradeId,
      });
    }
    await tx.insert(upgrades).values({
      id: upgradeId,
      userId,
      gameId: game.id,
      stakeType: stakeAmount > 0 ? 'balance' : 'items',
      stakeAmount,
      stakeValue,
      targetItemId: target.id,
      targetPrice: target.price,
      chance: chanceScaled,
      commission: s.commission.toFixed(4),
      maxChance: s.maxChance.toFixed(4),
      fairSeedId: rolls.seedId,
      nonce,
      roll,
      isWin,
      resultUserItemId,
    });
    if (locked.length) {
      await tx.insert(upgradeStakeItems).values(locked.map((l) => ({ upgradeId, userItemId: l.id, value: l.price })));
    }
    if (isWin) {
      const { delayMs } = await this.settings.get('feed');
      await this.outbox.add(
        tx,
        'drop.created',
        {
          game: game.code,
          source: 'upgrade',
          userId,
          drops: [
            {
              id: upgradeId,
              itemId: targetDto.id,
              skinName: targetDto.skinName,
              modelName: targetDto.modelName,
              imageUrl: targetDto.imageUrl,
              rarityColor: targetDto.rarity.color,
              price: targetDto.price,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        Math.min(delayMs, 4500),
      );
    }
    return {
      id: upgradeId,
      isWin,
      chance: chanceScaled,
      roll,
      stakeValue,
      target: targetDto,
      resultUserItemId,
      balance: await this.ledger.balanceOf(userId, tx),
      fair: { serverSeedHash: rolls.serverSeedHash, clientSeed: rolls.clientSeed, nonce },
    };
  }

  async history(userId: string, game: GameRow, limit = 20): Promise<UpgradeHistoryDto[]> {
    const rows = await this.db
      .select()
      .from(upgrades)
      .where(and(eq(upgrades.userId, userId), eq(upgrades.gameId, game.id)))
      .orderBy(desc(upgrades.createdAt))
      .limit(limit);
    const map = await this.catalog.getItemsByIds([...new Set(rows.map((r) => r.targetItemId))]);
    return rows
      .filter((r) => map.has(r.targetItemId))
      .map((r) => ({
        id: r.id,
        isWin: r.isWin,
        chance: r.chance,
        stakeValue: r.stakeValue,
        target: map.get(r.targetItemId) as UpgradeHistoryDto['target'],
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async proof(id: string): Promise<UpgradeProofDto> {
    const [u] = await this.db.select().from(upgrades).where(eq(upgrades.id, id));
    if (!u) throw notFound();
    const seed = await this.fairness.getSeed(u.fairSeedId);
    if (!seed) throw notFound();
    const revealed = seed.status === 'revealed';
    return {
      type: 'upgrade',
      id: u.id,
      revealed,
      serverSeed: revealed ? this.fairness.decrypt(seed.serverSeedEnc) : null,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: u.nonce,
      chance: u.chance,
      roll: u.roll,
      isWin: u.isWin,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async wonCount(userId: string, gameId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(upgrades)
      .where(and(eq(upgrades.userId, userId), eq(upgrades.gameId, gameId), eq(upgrades.isWin, true)));
    return row?.value ?? 0;
  }
}

