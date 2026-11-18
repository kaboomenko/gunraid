import { Inject, Injectable } from '@nestjs/common';
import { contractItems, contracts, items, newId, type Db, type DbOrTx } from '@gunraid/db';
import {
  contractGamma,
  contractMultiplier,
  contractRange,
  contractWinProbability,
  pickNearestByPrice,
  rollFloat,
} from '@gunraid/game-core';
import type {
  ContractBody,
  ContractConfigDto,
  ContractHistoryDto,
  ContractProofDto,
  ContractResultDto,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { FairnessService } from '../fairness/fairness.service.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class ContractService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  async config(): Promise<ContractConfigDto> {
    const s = await this.settings.get('contract');
    return {
      commission: s.commission,
      coefMin: s.coefMin,
      coefMax: s.coefMax,
      minItems: s.minItems,
      maxItems: s.maxItems,
      winProbability: contractWinProbability(s),
    };
  }

  /** Ближайший по цене предмет пула контрактов (сначала в пределах диапазона, иначе — среди всех). */
  private async pickResult(tx: DbOrTx, gameId: number, target: number, min: number, max: number) {
    const base = and(
      eq(items.gameId, gameId),
      eq(items.isActive, true),
      eq(items.inContract, true),
    );
    const near = async (cond: ReturnType<typeof and>) => {
      const [above, below] = await Promise.all([
        tx
          .select({ id: items.id, price: items.price })
          .from(items)
          .where(and(cond, gte(items.price, target)))
          .orderBy(asc(items.price), asc(items.id))
          .limit(1),
        tx
          .select({ id: items.id, price: items.price })
          .from(items)
          .where(and(cond, lte(items.price, target)))
          .orderBy(desc(items.price), asc(items.id))
          .limit(1),
      ]);
      return pickNearestByPrice([...above, ...below], target);
    };
    return (
      (await near(and(base, gte(items.price, min), lte(items.price, max)))) ?? (await near(base))
    );
  }

  /**
   * Контракт: предметы → used_contract, множитель k по броску provably fair,
   * результат — предмет с ценой, ближайшей к вложенному × k.
   */
  async sign(
    tx: DbOrTx,
    userId: string,
    game: GameRow,
    body: ContractBody,
  ): Promise<ContractResultDto> {
    const s = await this.settings.get('contract');
    if (body.userItemIds.length < s.minItems || body.userItemIds.length > s.maxItems) {
      throw new AppError('CONTRACT_ITEMS_COUNT', 400, { min: s.minItems, max: s.maxItems });
    }
    await this.ledger.lockWallet(tx, userId);
    const locked = await this.inventory.lockAvailable(tx, userId, game.id, body.userItemIds);
    const inputValue = locked.reduce((sum, it) => sum + it.price, 0);
    if (inputValue <= 0) throw new AppError('CONTRACT_NO_RESULT', 400);
    const gamma = contractGamma(s);
    const range = contractRange(inputValue, s);
    const contractId = newId();
    await this.inventory.consume(tx, userId, locked, 'used_contract', 'contract', contractId);

    const rolls = await this.fairness.reserve(tx, userId, 1);
    const nonce = rolls.nonces[0] as number;
    const roll = rollFloat(rolls.serverSeed, rolls.clientSeed, nonce);
    const multiplier = contractMultiplier(roll, s, gamma);
    const targetValue = Math.round(inputValue * multiplier);
    const picked = await this.pickResult(tx, game.id, targetValue, range.min, range.max);
    if (!picked) throw new AppError('CONTRACT_NO_RESULT', 409);
    const result = await this.catalog.getItem(game.id, picked.id, tx);
    const resultUserItemId = await this.inventory.grant(tx, {
      userId,
      gameId: game.id,
      itemId: result.id,
      value: result.price,
      sourceType: 'contract',
      sourceId: contractId,
    });
    await tx.insert(contracts).values({
      id: contractId,
      userId,
      gameId: game.id,
      inputValue,
      kMin: s.coefMin.toFixed(4),
      kMax: s.coefMax.toFixed(4),
      gamma,
      commission: s.commission.toFixed(4),
      fairSeedId: rolls.seedId,
      nonce,
      roll,
      multiplier,
      targetValue,
      resultItemId: result.id,
      resultValue: result.price,
      resultUserItemId,
    });
    await tx
      .insert(contractItems)
      .values(locked.map((l) => ({ contractId, userItemId: l.id, value: l.price })));
    await this.outbox.add(tx, 'wager.placed', {
      userId,
      amount: inputValue,
      sourceType: 'contract',
      sourceId: contractId,
    });
    const { delayMs } = await this.settings.get('feed');
    await this.outbox.add(
      tx,
      'drop.created',
      {
        game: game.code,
        source: 'contract',
        userId,
        drops: [
          {
            id: contractId,
            itemId: result.id,
            skinName: result.skinName,
            modelName: result.modelName,
            imageUrl: result.imageUrl,
            rarityColor: result.rarity.color,
            price: result.price,
          },
        ],
        createdAt: new Date().toISOString(),
      },
      Math.min(delayMs, 4000),
    );
    return {
      id: contractId,
      inputValue,
      min: range.min,
      max: range.max,
      multiplier,
      targetValue,
      result,
      resultUserItemId,
      fair: { serverSeedHash: rolls.serverSeedHash, clientSeed: rolls.clientSeed, nonce },
    };
  }

  async history(userId: string, game: GameRow, limit = 20): Promise<ContractHistoryDto[]> {
    const rows = await this.db
      .select()
      .from(contracts)
      .where(and(eq(contracts.userId, userId), eq(contracts.gameId, game.id)))
      .orderBy(desc(contracts.createdAt))
      .limit(limit);
    const map = await this.catalog.getItemsByIds([...new Set(rows.map((r) => r.resultItemId))]);
    return rows
      .filter((r) => map.has(r.resultItemId))
      .map((r) => ({
        id: r.id,
        inputValue: r.inputValue,
        multiplier: r.multiplier,
        result: map.get(r.resultItemId) as ContractHistoryDto['result'],
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async proof(id: string): Promise<ContractProofDto> {
    const [c] = await this.db.select().from(contracts).where(eq(contracts.id, id));
    if (!c) throw notFound();
    const seed = await this.fairness.getSeed(c.fairSeedId);
    if (!seed) throw notFound();
    const revealed = seed.status === 'revealed';
    return {
      type: 'contract',
      id: c.id,
      revealed,
      serverSeed: revealed ? this.fairness.decrypt(seed.serverSeedEnc) : null,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: c.nonce,
      coefMin: Number(c.kMin),
      coefMax: Number(c.kMax),
      gamma: c.gamma,
      multiplier: c.multiplier,
      inputValue: c.inputValue,
      targetValue: c.targetValue,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async doneCount(userId: string, gameId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(contracts)
      .where(and(eq(contracts.userId, userId), eq(contracts.gameId, gameId)));
    return row?.value ?? 0;
  }
}
