import { Inject, Injectable } from '@nestjs/common';
import {
  cases,
  deposits,
  newId,
  userCooldowns,
  users,
  wheelPrizes,
  wheelSpins,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import { pickWeighted, rollFloat } from '@gunraid/game-core';
import type {
  ItemDto,
  WheelBlockReason,
  WheelPrizeDto,
  WheelProofDto,
  WheelSpinDto,
  WheelSpinResultDto,
  WheelStateDto,
} from '@gunraid/shared';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
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
import { EntitlementsService } from './entitlements.service.js';

type PrizeRow = typeof wheelPrizes.$inferSelect;

const HOUR = 60 * 60 * 1000;
const COOLDOWN_KEY = 'wheel';
/** Длительность анимации колеса — дроп предмета попадёт в ленту после остановки. */
const SPIN_ANIMATION_MS = 5500;

/** Колесо фортуны: бесплатное вращение раз в N часов, доп. вращения по бонусам, призы с весами. */
@Injectable()
export class WheelService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly settings: SettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly outbox: OutboxService,
  ) {}

  private async prizeRows(gameId: number, tx: DbOrTx = this.db): Promise<PrizeRow[]> {
    return tx
      .select()
      .from(wheelPrizes)
      .where(and(eq(wheelPrizes.gameId, gameId), eq(wheelPrizes.isActive, true)))
      .orderBy(asc(wheelPrizes.sortOrder), asc(wheelPrizes.id));
  }

  private async toDtos(rows: PrizeRow[], tx: DbOrTx = this.db): Promise<WheelPrizeDto[]> {
    const itemIds = rows.flatMap((r) => (r.itemId ? [r.itemId] : []));
    const caseIds = rows.flatMap((r) => (r.caseId ? [r.caseId] : []));
    const [itemMap, caseRows] = await Promise.all([
      this.catalog.getItemsByIds(itemIds, tx),
      caseIds.length
        ? tx
            .select({ id: cases.id, name: cases.name, imageUrl: cases.imageUrl })
            .from(cases)
            .where(inArray(cases.id, caseIds))
        : Promise.resolve([]),
    ]);
    const caseMap = new Map(caseRows.map((c) => [c.id, c]));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      label: localize(r.label),
      color: r.color,
      amount: r.amount,
      percent: r.percent !== null ? Number(r.percent) : null,
      maxAmount: r.maxAmount,
      item: (r.itemId ? itemMap.get(r.itemId) : null) ?? null,
      caseName: r.caseId ? localize(caseMap.get(r.caseId)?.name) : null,
      caseImage: r.caseId ? (caseMap.get(r.caseId)?.imageUrl ?? null) : null,
    }));
  }

  /** Условия доступа (антиабуз): возраст аккаунта и пополнение за последние N дней. */
  private async blockReason(userId: string, tx: DbOrTx): Promise<WheelBlockReason | null> {
    const s = await this.settings.get('wheel');
    const [u] = await tx
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) return 'LOGIN';
    if (u.createdAt.getTime() > Date.now() - s.minAccountAgeHours * HOUR) return 'ACCOUNT_AGE';
    if (s.requireDepositWithinDays) {
      const [d] = await tx
        .select({ id: deposits.id })
        .from(deposits)
        .where(
          and(
            eq(deposits.userId, userId),
            eq(deposits.status, 'succeeded'),
            gte(
              deposits.completedAt,
              new Date(Date.now() - s.requireDepositWithinDays * 24 * HOUR),
            ),
          ),
        )
        .limit(1);
      if (!d) return 'NO_DEPOSIT';
    }
    return null;
  }

  async state(
    game: GameRow,
    user: { userId: string; adultConfirmed: boolean } | null,
  ): Promise<WheelStateDto> {
    const s = await this.settings.get('wheel');
    const prizes = await this.toDtos(await this.prizeRows(game.id));
    const base = {
      prizes,
      cooldownHours: s.cooldownHours,
      minAccountAgeHours: s.minAccountAgeHours,
      requireDepositWithinDays: s.requireDepositWithinDays,
    };
    if (!user) {
      return { ...base, canSpin: false, reason: 'LOGIN', nextAt: null, extraSpins: 0, history: [] };
    }
    const [[cd], extraSpins, history, conditions] = await Promise.all([
      this.db
        .select({ availableAt: userCooldowns.availableAt })
        .from(userCooldowns)
        .where(and(eq(userCooldowns.userId, user.userId), eq(userCooldowns.key, COOLDOWN_KEY))),
      this.entitlements.count(user.userId, 'wheel_spin'),
      this.history(user.userId, game.id),
      this.blockReason(user.userId, this.db),
    ]);
    const nextAt =
      cd && cd.availableAt.getTime() > Date.now() ? cd.availableAt.toISOString() : null;
    let reason: WheelBlockReason | null = null;
    if (!user.adultConfirmed) reason = 'ADULT';
    else if (conditions) reason = conditions;
    else if (nextAt && extraSpins === 0) reason = 'COOLDOWN';
    return { ...base, canSpin: reason === null, reason, nextAt, extraSpins, history };
  }

  async history(userId: string, gameId: number, limit = 10): Promise<WheelSpinDto[]> {
    const rows = await this.db
      .select()
      .from(wheelSpins)
      .where(and(eq(wheelSpins.userId, userId), eq(wheelSpins.gameId, gameId)))
      .orderBy(desc(wheelSpins.createdAt))
      .limit(limit);
    if (!rows.length) return [];
    const prizes = await this.db
      .select()
      .from(wheelPrizes)
      .where(inArray(wheelPrizes.id, [...new Set(rows.map((r) => r.prizeId))]));
    const dtos = new Map((await this.toDtos(prizes)).map((p) => [p.id, p]));
    return rows.flatMap((r) => {
      const prize = dtos.get(r.prizeId);
      return prize
        ? [{ id: r.id, prize, isExtra: r.isExtra, createdAt: r.createdAt.toISOString() }]
        : [];
    });
  }

  /**
   * Вращение. Порядок блокировок: кошелёк → кулдаун → право на доп. вращение → пара сидов.
   * Бесплатное вращение ставит кулдаун; если он не прошёл — тратится право «доп. вращение».
   */
  async spin(tx: DbOrTx, userId: string, game: GameRow): Promise<WheelSpinResultDto> {
    const s = await this.settings.get('wheel');
    await this.ledger.lockWallet(tx, userId);
    const blocked = await this.blockReason(userId, tx);
    if (blocked) throw new AppError('WHEEL_CONDITIONS_NOT_MET', 403, { reason: blocked });
    const rows = await this.prizeRows(game.id, tx);
    if (!rows.length) throw notFound();

    await tx
      .insert(userCooldowns)
      .values({ userId, key: COOLDOWN_KEY, availableAt: new Date(0) })
      .onConflictDoNothing();
    const [cd] = await tx
      .select()
      .from(userCooldowns)
      .where(and(eq(userCooldowns.userId, userId), eq(userCooldowns.key, COOLDOWN_KEY)))
      .for('update');
    const spinId = newId();
    let isExtra = false;
    let nextAt: string | null = null;
    if (cd && cd.availableAt.getTime() > Date.now()) {
      const extra = await this.entitlements.lockOne(tx, userId, 'wheel_spin');
      if (!extra) {
        throw new AppError('WHEEL_COOLDOWN', 409, { availableAt: cd.availableAt.toISOString() });
      }
      await this.entitlements.consume(tx, extra.id, spinId);
      isExtra = true;
      nextAt = cd.availableAt.toISOString();
    } else {
      const next = new Date(Date.now() + s.cooldownHours * HOUR);
      await tx
        .update(userCooldowns)
        .set({ availableAt: next })
        .where(and(eq(userCooldowns.userId, userId), eq(userCooldowns.key, COOLDOWN_KEY)));
      nextAt = next.toISOString();
    }

    const rolls = await this.fairness.reserve(tx, userId, 1);
    const nonce = rolls.nonces[0]!;
    const roll = rollFloat(rolls.serverSeed, rolls.clientSeed, nonce);
    const { index, ticket } = pickWeighted(
      rows.map((r) => r.weight),
      roll,
    );
    const prize = rows[index]!;
    const [prizeDto] = await this.toDtos([prize], tx);

    let balance: number | null = null;
    let resultRefType: string | null = null;
    let resultRefId: string | null = null;
    switch (prize.type) {
      case 'balance': {
        const res = await this.ledger.post(tx, {
          userId,
          type: 'wheel_prize',
          amount: prize.amount ?? 0,
          refType: 'wheel_spin',
          refId: spinId,
          idempotencyKey: `wheel:${spinId}`,
        });
        balance = res.balanceAfter;
        resultRefType = 'ledger';
        resultRefId = String(res.entryId);
        break;
      }
      case 'item': {
        const item = prizeDto?.item as ItemDto;
        resultRefId = await this.inventory.grant(tx, {
          userId,
          gameId: game.id,
          itemId: item.id,
          value: item.price,
          sourceType: 'wheel',
          sourceId: spinId,
        });
        resultRefType = 'user_item';
        await this.outbox.add(
          tx,
          'drop.created',
          {
            game: game.code,
            source: 'wheel',
            userId,
            drops: [
              {
                id: resultRefId,
                itemId: item.id,
                skinName: item.skinName,
                modelName: item.modelName,
                imageUrl: item.imageUrl,
                rarityColor: item.rarity.color,
                price: item.price,
              },
            ],
            createdAt: new Date().toISOString(),
          },
          SPIN_ANIMATION_MS,
        );
        break;
      }
      case 'free_case':
      case 'deposit_bonus':
      case 'extra_spin': {
        resultRefId = await this.entitlements.grant(tx, {
          userId,
          type:
            prize.type === 'free_case'
              ? 'free_case'
              : prize.type === 'extra_spin'
                ? 'wheel_spin'
                : 'deposit_bonus',
          caseId: prize.caseId,
          percent: prize.percent !== null ? Number(prize.percent) : null,
          maxAmount: prize.maxAmount,
          sourceType: 'wheel',
          sourceId: spinId,
        });
        resultRefType = 'entitlement';
        break;
      }
    }

    await tx.insert(wheelSpins).values({
      id: spinId,
      userId,
      gameId: game.id,
      prizeId: prize.id,
      prizesSnapshot: rows.map((r) => ({
        id: r.id,
        type: r.type,
        weight: r.weight,
        label: localize(r.label),
      })),
      prizeIndex: index,
      isExtra,
      fairSeedId: rolls.seedId,
      nonce,
      roll,
      ticket,
      resultRefType,
      resultRefId,
    });

    return {
      id: spinId,
      prizeIndex: index,
      prize: prizeDto!,
      isExtra,
      balance: balance ?? (await this.ledger.balanceOf(userId, tx)),
      nextAt,
      extraSpins: await this.entitlements.count(userId, 'wheel_spin', undefined, tx),
      fair: { serverSeedHash: rolls.serverSeedHash, clientSeed: rolls.clientSeed, nonce },
    };
  }

  async proof(spinId: string): Promise<WheelProofDto> {
    const [spin] = await this.db.select().from(wheelSpins).where(eq(wheelSpins.id, spinId));
    if (!spin) throw notFound();
    const seed = await this.fairness.getSeed(spin.fairSeedId);
    if (!seed) throw notFound();
    const revealed = seed.status === 'revealed';
    return {
      type: 'wheel_spin',
      id: spin.id,
      revealed,
      serverSeed: revealed ? this.fairness.decrypt(seed.serverSeedEnc) : null,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: spin.nonce,
      ticket: spin.ticket,
      prizeIndex: spin.prizeIndex,
      prizes: spin.prizesSnapshot.map((p) => ({ id: p.id, label: p.label, weight: p.weight })),
      createdAt: spin.createdAt.toISOString(),
    };
  }
}
