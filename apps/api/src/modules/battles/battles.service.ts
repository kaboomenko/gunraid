import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  battleCases,
  battleDrops,
  battleParticipants,
  battles,
  botProfiles,
  caseRevisions,
  cases,
  fairSeeds,
  games,
  inventoryEvents,
  newId,
  userItems,
  users,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import {
  battleClientSeed,
  battleRecipient,
  battleRoll,
  battleTeamOf,
  battleTiebreak,
  pickByTicket,
  resolveBattle,
  sha256Hex,
  ticketFromFloat,
} from '@gunraid/game-core';
import {
  BATTLE_FORMAT_SLOTS,
  BATTLE_ROUND_LEAD_MS,
  BATTLE_ROUND_PAUSE_MS,
  type BattleBotsBody,
  type BattleCaseOptionDto,
  type BattleConfigDto,
  type BattleCreateBody,
  type BattleDropDto,
  type BattleDto,
  type BattleJoinBody,
  type BattleListCaseDto,
  type BattleListDto,
  type BattleListItemDto,
  type BattleListQuery,
  type BattlePlayerDto,
  type BattleProofDto,
  type BattleRoundCaseDto,
  type BattleRoundEventDto,
  type ItemDto,
} from '@gunraid/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { localize } from '../catalog/item-mapper.js';
import { FairnessService } from '../fairness/fairness.service.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { DropEventPayload } from '../feed/feed.handlers.js';

type BattleRow = typeof battles.$inferSelect;
type ParticipantRow = typeof battleParticipants.$inferSelect;
type DropRow = typeof battleDrops.$inferSelect;

export interface BattleMutation {
  battleId: string;
  game: string;
  /** Новые балансы (для события balance:update). */
  balances: Array<{ userId: string; balance: number }>;
  started: boolean;
}

export interface BattleFinalized {
  battleId: string;
  game: string;
  /** Пользователи, получившие предметы (для inventory:update). */
  recipients: string[];
}

const battleNotFound = () => new AppError('BATTLE_NOT_FOUND', 404);

/** Сколько раундов уже можно показывать (результат приходит за BATTLE_ROUND_LEAD_MS до старта вращения). */
export function revealedRounds(b: BattleRow, now = Date.now()): number {
  if (b.status === 'finished') return b.roundsCount;
  if (b.status !== 'in_progress' || !b.startsAt) return 0;
  const elapsed = now - b.startsAt.getTime() + BATTLE_ROUND_LEAD_MS;
  if (elapsed < 0) return 0;
  return Math.min(b.roundsCount, Math.floor(elapsed / b.roundDurationMs) + 1);
}

/**
 * Кейс-баттлы.
 * Порядок блокировок: кошельки (по возрастанию id) → строка баттла. Старт баттла (заполнено последнее место)
 * происходит в той же транзакции: фиксируется client seed, считаются все броски, назначаются время раундов
 * и события outbox (показ раундов, выдача выигрыша). Предметы выдаются воркером после последнего раунда.
 */
@Injectable()
export class BattlesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  async config(): Promise<BattleConfigDto> {
    const s = await this.settings.get('battle');
    return {
      maxCases: s.maxCases,
      roundDurationMs: s.roundDurationMs,
      countdownMs: s.countdownMs,
      allowBots: s.allowBots,
      lobbyTimeoutMinutes: s.lobbyTimeoutMinutes,
    };
  }

  /** Обычные платные кейсы без тиража, уровня и кулдауна. */
  private eligibleCase(): SQL {
    return and(
      eq(cases.isActive, true),
      eq(cases.kind, 'paid'),
      gt(cases.price, 0),
      isNull(cases.minLevel),
      isNull(cases.supplyTotal),
      isNull(cases.cooldownSeconds),
      isNotNull(cases.currentRevisionId),
      or(isNull(cases.availableFrom), lte(cases.availableFrom, sql`now()`)),
      or(isNull(cases.availableUntil), gt(cases.availableUntil, sql`now()`)),
    )!;
  }

  async eligibleCases(game: GameRow): Promise<BattleCaseOptionDto[]> {
    const rows = await this.db
      .select({
        id: cases.id,
        slug: cases.slug,
        name: cases.name,
        imageUrl: cases.imageUrl,
        accentColor: cases.accentColor,
        price: cases.price,
      })
      .from(cases)
      .where(and(eq(cases.gameId, game.id), this.eligibleCase()))
      .orderBy(asc(cases.price), asc(cases.sortOrder));
    return rows.map((r) => ({ ...r, name: localize(r.name) }));
  }

  private async lockBattle(tx: DbOrTx, battleId: string): Promise<BattleRow> {
    const [b] = await tx.select().from(battles).where(eq(battles.id, battleId)).for('update');
    if (!b) throw battleNotFound();
    return b;
  }

  /** Снимок client seed пользователя на момент входа (активная пара сидов; без пары — случайный). */
  private async userClientSeed(tx: DbOrTx, userId: string): Promise<string> {
    const [row] = await tx
      .select({ clientSeed: fairSeeds.clientSeed })
      .from(fairSeeds)
      .where(and(eq(fairSeeds.userId, userId), eq(fairSeeds.status, 'active')));
    return row?.clientSeed ?? this.fairness.newClientSeed();
  }

  async create(
    tx: DbOrTx,
    userId: string,
    game: GameRow,
    body: BattleCreateBody,
  ): Promise<BattleMutation> {
    const s = await this.settings.get('battle');
    const totalCount = body.cases.reduce((a, c) => a + c.count, 0);
    if (totalCount > s.maxCases) {
      throw new AppError('BATTLE_CASES_INVALID', 400, { reason: 'too_many', max: s.maxCases });
    }
    const caseIds = [...new Set(body.cases.map((c) => c.caseId))];
    const rows = await tx
      .select({ id: cases.id, price: cases.price, revisionId: cases.currentRevisionId })
      .from(cases)
      .where(and(inArray(cases.id, caseIds), eq(cases.gameId, game.id), this.eligibleCase()));
    if (rows.length !== caseIds.length) {
      throw new AppError('BATTLE_CASES_INVALID', 400, { reason: 'unavailable' });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rounds = body.cases.flatMap((c) =>
      Array.from({ length: c.count }, () => byId.get(c.caseId)!),
    );
    const entryPrice = rounds.reduce((a, r) => a + r.price, 0);

    await this.ledger.lockWallet(tx, userId);
    const battleId = newId();
    const { balanceAfter } = await this.ledger.post(tx, {
      userId,
      type: 'battle_entry',
      amount: -entryPrice,
      refType: 'battle',
      refId: battleId,
      idempotencyKey: `battle_entry:${battleId}:${userId}`,
    });
    const serverSeed = this.fairness.newServerSeed();
    await tx.insert(battles).values({
      id: battleId,
      gameId: game.id,
      creatorId: userId,
      format: body.format,
      mode: body.mode,
      maxPlayers: BATTLE_FORMAT_SLOTS[body.format],
      entryPrice,
      roundsCount: rounds.length,
      roundDurationMs: s.roundDurationMs,
      serverSeedEnc: this.fairness.encrypt(serverSeed),
      serverSeedHash: sha256Hex(serverSeed),
      expiresAt: new Date(Date.now() + s.lobbyTimeoutMinutes * 60_000),
    });
    await tx.insert(battleCases).values(
      rounds.map((r, i) => ({
        battleId,
        roundIndex: i,
        caseId: r.id,
        revisionId: r.revisionId!,
        price: r.price,
      })),
    );
    await tx.insert(battleParticipants).values({
      battleId,
      slot: 0,
      team: battleTeamOf(body.format, 0),
      userId,
      clientSeed: await this.userClientSeed(tx, userId),
      paidAmount: entryPrice,
    });
    await this.outbox.add(tx, 'battle.expire', { battleId }, s.lobbyTimeoutMinutes * 60_000);
    return {
      battleId,
      game: game.code,
      balances: [{ userId, balance: balanceAfter }],
      started: false,
    };
  }

  async join(
    tx: DbOrTx,
    userId: string,
    battleId: string,
    body: BattleJoinBody,
  ): Promise<BattleMutation> {
    await this.ledger.lockWallet(tx, userId);
    const b = await this.lockBattle(tx, battleId);
    if (b.status !== 'waiting') throw new AppError('BATTLE_NOT_WAITING', 409);
    const parts = await tx
      .select({ slot: battleParticipants.slot, userId: battleParticipants.userId })
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, battleId));
    if (parts.some((p) => p.userId === userId)) throw new AppError('BATTLE_ALREADY_JOINED', 409);
    const taken = new Set(parts.map((p) => p.slot));
    if (taken.size >= b.maxPlayers) throw new AppError('BATTLE_FULL', 409);
    let slot = body.slot;
    if (slot !== undefined) {
      if (slot >= b.maxPlayers || taken.has(slot)) throw new AppError('BATTLE_SLOT_TAKEN', 409);
    } else {
      slot = Array.from({ length: b.maxPlayers }, (_, i) => i).find((i) => !taken.has(i))!;
    }
    const { balanceAfter } = await this.ledger.post(tx, {
      userId,
      type: 'battle_entry',
      amount: -b.entryPrice,
      refType: 'battle',
      refId: battleId,
      idempotencyKey: `battle_entry:${battleId}:${userId}`,
    });
    await tx.insert(battleParticipants).values({
      battleId,
      slot,
      team: battleTeamOf(b.format, slot),
      userId,
      clientSeed: await this.userClientSeed(tx, userId),
      paidAmount: b.entryPrice,
    });
    const started = taken.size + 1 === b.maxPlayers;
    if (started) await this.start(tx, b);
    return {
      battleId,
      game: await this.gameCode(b.gameId, tx),
      balances: [{ userId, balance: balanceAfter }],
      started,
    };
  }

  /** Создатель заполняет свободные места ботами — баттл сразу стартует. */
  async addBots(
    tx: DbOrTx,
    userId: string,
    battleId: string,
    body: BattleBotsBody,
  ): Promise<BattleMutation> {
    const s = await this.settings.get('battle');
    if (!s.allowBots) throw new AppError('BATTLE_BOTS_DISABLED', 403);
    const b = await this.lockBattle(tx, battleId);
    if (b.creatorId !== userId) throw new AppError('BATTLE_NOT_CREATOR', 403);
    if (b.status !== 'waiting') throw new AppError('BATTLE_NOT_WAITING', 409);
    const parts = await tx
      .select({ slot: battleParticipants.slot })
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, battleId));
    const taken = new Set(parts.map((p) => p.slot));
    const free = Array.from({ length: b.maxPlayers }, (_, i) => i).filter((i) => !taken.has(i));
    if (!free.length) throw new AppError('BATTLE_FULL', 409);
    const bots = await tx.select({ id: botProfiles.id }).from(botProfiles);
    if (bots.length < free.length) throw new Error('not enough bot profiles');
    // Случайные разные боты (на исход не влияет — только ники).
    for (let i = bots.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [bots[i], bots[j]] = [bots[j]!, bots[i]!];
    }
    const base = body.clientSeed ?? this.fairness.newClientSeed();
    await tx.insert(battleParticipants).values(
      free.map((slot, i) => ({
        battleId,
        slot,
        team: battleTeamOf(b.format, slot),
        botId: bots[i]!.id,
        clientSeed: sha256Hex(`${base}:${slot}`),
      })),
    );
    await this.start(tx, b);
    return { battleId, game: await this.gameCode(b.gameId, tx), balances: [], started: true };
  }

  /**
   * Старт: client seed баттла, все броски и дропы, победитель, расписание раундов.
   * Результаты хранятся сразу, но API и WS показывают раунд только к моменту его вращения;
   * предметы выдаются в finalize после последнего раунда.
   */
  private async start(tx: DbOrTx, b: BattleRow): Promise<void> {
    const s = await this.settings.get('battle');
    const parts = await tx
      .select()
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, b.id))
      .orderBy(asc(battleParticipants.slot));
    if (parts.length !== b.maxPlayers) throw new Error('battle is not full');
    const clientSeed = battleClientSeed(parts.map((p) => p.clientSeed));
    const serverSeed = this.fairness.decrypt(b.serverSeedEnc);
    const rounds = await tx
      .select()
      .from(battleCases)
      .where(eq(battleCases.battleId, b.id))
      .orderBy(asc(battleCases.roundIndex));
    const revIds = [...new Set(rounds.map((r) => r.revisionId))];
    const revs = await tx
      .select({ id: caseRevisions.id, contents: caseRevisions.contents })
      .from(caseRevisions)
      .where(inArray(caseRevisions.id, revIds));
    const revMap = new Map(revs.map((r) => [r.id, r.contents]));

    const drops: Array<{
      roundIndex: number;
      slot: number;
      itemId: string;
      roll: number;
      ticket: number;
    }> = [];
    for (const r of rounds) {
      const contents = revMap.get(r.revisionId);
      if (!contents?.length) throw new Error(`revision ${r.revisionId} is empty`);
      for (let slot = 0; slot < b.maxPlayers; slot++) {
        const roll = battleRoll(serverSeed, clientSeed, r.roundIndex, slot);
        const ticket = ticketFromFloat(roll);
        drops.push({
          roundIndex: r.roundIndex,
          slot,
          itemId: pickByTicket(contents, ticket).itemId,
          roll,
          ticket,
        });
      }
    }
    const itemMap = await this.catalog.getItemsByIds([...new Set(drops.map((d) => d.itemId))], tx);
    const valueOf = (itemId: string) => itemMap.get(itemId)?.price ?? 0;

    const totals = Array.from({ length: b.maxPlayers }, () => 0);
    for (const d of drops) totals[d.slot]! += valueOf(d.itemId);
    const tiebreak = battleTiebreak(serverSeed, clientSeed);
    const res = resolveBattle(b.format, b.mode, totals, tiebreak);
    const payouts = Array.from({ length: b.maxPlayers }, () => 0);
    const recipients = drops.map((d) => battleRecipient(b.format, res.winnerSlots, d.slot));
    drops.forEach((d, i) => (payouts[recipients[i]!]! += valueOf(d.itemId)));

    await tx.insert(battleDrops).values(
      drops.map((d, i) => ({
        battleId: b.id,
        roundIndex: d.roundIndex,
        slot: d.slot,
        itemId: d.itemId,
        itemValue: valueOf(d.itemId),
        roll: d.roll,
        ticket: d.ticket,
        recipientSlot: recipients[i]!,
      })),
    );
    for (const p of parts) {
      await tx
        .update(battleParticipants)
        .set({
          totalValue: totals[p.slot]!,
          isWinner: res.winnerSlots.includes(p.slot),
          payoutValue: payouts[p.slot]!,
        })
        .where(and(eq(battleParticipants.battleId, b.id), eq(battleParticipants.slot, p.slot)));
    }

    const now = Date.now();
    const startsAt = now + s.countdownMs;
    const endsAt = startsAt + b.roundsCount * b.roundDurationMs;
    await tx
      .update(battles)
      .set({
        status: 'in_progress',
        clientSeed,
        tiebreakRoll: tiebreak,
        winnerTeam: res.winnerTeam,
        totalValue: totals.reduce((a, v) => a + v, 0),
        startedAt: new Date(now),
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      })
      .where(eq(battles.id, b.id));

    // Показ раундов и выдача выигрыша — события outbox по расписанию.
    for (const r of rounds) {
      const spinAt = startsAt + r.roundIndex * b.roundDurationMs;
      await this.outbox.add(
        tx,
        'battle.round',
        { battleId: b.id, round: r.roundIndex },
        spinAt - BATTLE_ROUND_LEAD_MS - now,
      );
    }
    await this.outbox.add(tx, 'battle.finalize', { battleId: b.id }, endsAt - now);

    // Лента: дропы игроков (не ботов) — после остановки рулетки раунда.
    const caseRows = await tx
      .select({ id: cases.id, slug: cases.slug, name: cases.name, imageUrl: cases.imageUrl })
      .from(cases)
      .where(inArray(cases.id, [...new Set(rounds.map((r) => r.caseId))]));
    const caseMap = new Map(caseRows.map((c) => [c.id, c]));
    const game = await this.gameCode(b.gameId, tx);
    const spinMs = Math.max(0, b.roundDurationMs - BATTLE_ROUND_PAUSE_MS);
    for (const r of rounds) {
      const c = caseMap.get(r.caseId);
      const stopAt = startsAt + r.roundIndex * b.roundDurationMs + spinMs;
      for (const p of parts) {
        if (!p.userId) continue;
        const d = drops.find((x) => x.roundIndex === r.roundIndex && x.slot === p.slot)!;
        const item = itemMap.get(d.itemId);
        if (!item) continue;
        const payload: DropEventPayload = {
          game,
          source: 'battle',
          userId: p.userId,
          caseSlug: c?.slug ?? null,
          caseName: c ? localize(c.name) : null,
          caseImage: c?.imageUrl ?? null,
          drops: [
            {
              id: `${b.id}:${r.roundIndex}:${p.slot}`,
              itemId: item.id,
              skinName: item.skinName,
              modelName: item.modelName,
              imageUrl: item.imageUrl,
              rarityColor: item.rarity.color,
              price: item.price,
            },
          ],
          createdAt: new Date(stopAt).toISOString(),
        };
        await this.outbox.add(
          tx,
          'drop.created',
          payload as unknown as Record<string, unknown>,
          stopAt - now,
        );
      }
    }
  }

  /**
   * Выдача выигрыша после последнего раунда (воркер). Идемпотентно: повтор для завершённого баттла — no-op.
   * Проигравшим остаётся запись в истории со статусом «проигран в баттле».
   */
  async finalize(battleId: string): Promise<BattleFinalized | null> {
    return this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(battles).where(eq(battles.id, battleId)).for('update');
      if (!b || b.status !== 'in_progress') return null;
      const parts = await tx
        .select()
        .from(battleParticipants)
        .where(eq(battleParticipants.battleId, battleId));
      const bySlot = new Map(parts.map((p) => [p.slot, p]));
      const drops = await tx
        .select()
        .from(battleDrops)
        .where(eq(battleDrops.battleId, battleId))
        .orderBy(asc(battleDrops.roundIndex), asc(battleDrops.slot));
      const recipients = new Set<string>();
      for (const d of drops) {
        const opener = bySlot.get(d.slot);
        const recipient = bySlot.get(d.recipientSlot ?? d.slot);
        if (recipient?.userId) {
          const userItemId = await this.inventory.grant(tx, {
            userId: recipient.userId,
            gameId: b.gameId,
            itemId: d.itemId,
            value: d.itemValue,
            sourceType: 'battle',
            sourceId: battleId,
          });
          recipients.add(recipient.userId);
          await tx
            .update(battleDrops)
            .set({ userItemId })
            .where(
              and(
                eq(battleDrops.battleId, battleId),
                eq(battleDrops.roundIndex, d.roundIndex),
                eq(battleDrops.slot, d.slot),
              ),
            );
        }
        if (opener?.userId && opener.userId !== recipient?.userId) {
          await this.recordLost(tx, opener.userId, b, d);
        }
      }
      await tx
        .update(battles)
        .set({ status: 'finished', finishedAt: sql`now()` })
        .where(eq(battles.id, battleId));
      await this.outbox.add(tx, 'battle.finished', {
        battleId,
        participants: parts
          .filter((p) => p.userId)
          .map((p) => ({ userId: p.userId, paid: p.paidAmount, isWinner: p.isWinner })),
      });
      return { battleId, game: await this.gameCode(b.gameId, tx), recipients: [...recipients] };
    });
  }

  /** Запись в истории проигравшего: предмет выпал ему, но ушёл победителю. */
  private async recordLost(tx: DbOrTx, userId: string, b: BattleRow, d: DropRow): Promise<void> {
    const id = newId();
    await tx.insert(userItems).values({
      id,
      userId,
      gameId: b.gameId,
      itemId: d.itemId,
      status: 'lost_battle',
      acquiredValue: d.itemValue,
      sourceType: 'battle',
      sourceId: b.id,
      consumedRefType: 'battle',
      consumedRefId: b.id,
    });
    await tx.insert(inventoryEvents).values({
      userItemId: id,
      userId,
      type: 'lost_battle',
      value: d.itemValue,
      refType: 'battle',
      refId: b.id,
    });
  }

  /**
   * Отмена лобби (создателем или по таймауту) с возвратом всем участникам.
   * Сначала кошельки участников (по возрастанию id), затем строка баттла — тот же порядок, что при входе.
   */
  async cancel(
    battleId: string,
    reason: 'creator' | 'timeout',
    actorId: string | null,
  ): Promise<BattleMutation> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.db.transaction(async (tx) => {
        const before = await tx
          .select({ userId: battleParticipants.userId })
          .from(battleParticipants)
          .where(
            and(eq(battleParticipants.battleId, battleId), isNotNull(battleParticipants.userId)),
          );
        const userIds = [...new Set(before.map((p) => p.userId!))].sort();
        for (const u of userIds) await this.ledger.lockWallet(tx, u);
        const b = await this.lockBattle(tx, battleId);
        if (actorId && b.creatorId !== actorId) throw new AppError('BATTLE_NOT_CREATOR', 403);
        if (b.status !== 'waiting') throw new AppError('BATTLE_NOT_WAITING', 409);
        if (reason === 'timeout' && b.expiresAt.getTime() > Date.now()) {
          throw new AppError('BATTLE_NOT_WAITING', 409, { reason: 'not_expired' });
        }
        const parts = await tx
          .select()
          .from(battleParticipants)
          .where(eq(battleParticipants.battleId, battleId));
        const now = [...new Set(parts.flatMap((p) => (p.userId ? [p.userId] : [])))].sort();
        if (now.join(',') !== userIds.join(',')) return null; // кто-то вошёл между чтением и блокировкой
        const balances: BattleMutation['balances'] = [];
        for (const p of parts) {
          if (!p.userId || p.paidAmount <= 0) continue;
          const { balanceAfter } = await this.ledger.post(tx, {
            userId: p.userId,
            type: 'battle_refund',
            amount: p.paidAmount,
            refType: 'battle',
            refId: battleId,
            idempotencyKey: `battle_refund:${battleId}:${p.userId}`,
          });
          balances.push({ userId: p.userId, balance: balanceAfter });
        }
        await tx
          .update(battles)
          .set({ status: 'cancelled', cancelReason: reason, finishedAt: sql`now()` })
          .where(eq(battles.id, battleId));
        return {
          battleId,
          game: await this.gameCode(b.gameId, tx),
          balances,
          started: false,
        } satisfies BattleMutation;
      });
      if (result) return result;
    }
    throw new AppError('CONFLICT', 409, { reason: 'battle_busy' });
  }

  /** Обработчик таймаута лобби: закрывает только всё ещё ждущие и истёкшие баттлы. */
  async expire(battleId: string): Promise<BattleMutation | null> {
    const [b] = await this.db
      .select({ status: battles.status, expiresAt: battles.expiresAt })
      .from(battles)
      .where(eq(battles.id, battleId));
    if (!b || b.status !== 'waiting') return null;
    if (b.expiresAt.getTime() > Date.now()) return null;
    try {
      return await this.cancel(battleId, 'timeout', null);
    } catch (err) {
      if (err instanceof AppError && err.code === 'BATTLE_NOT_WAITING') return null;
      throw err;
    }
  }

  private gameCodeCache = new Map<number, string>();

  private async gameCode(gameId: number, tx: DbOrTx = this.db): Promise<string> {
    const hit = this.gameCodeCache.get(gameId);
    if (hit) return hit;
    const [g] = await tx.select({ code: games.code }).from(games).where(eq(games.id, gameId));
    if (!g) throw new Error(`game ${gameId} missing`);
    this.gameCodeCache.set(gameId, g.code);
    return g.code;
  }

  // ---------- Чтение ----------

  private async loadPlayers(battleIds: string[]): Promise<
    Map<
      string,
      Array<
        ParticipantRow & {
          u: BattlePlayerDto['user'];
          botNick: string | null;
          botAvatar: string | null;
        }
      >
    >
  > {
    const map = new Map<
      string,
      Array<
        ParticipantRow & {
          u: BattlePlayerDto['user'];
          botNick: string | null;
          botAvatar: string | null;
        }
      >
    >();
    if (!battleIds.length) return map;
    const rows = await this.db
      .select({
        p: battleParticipants,
        userId: users.id,
        shortId: users.shortId,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
        level: users.level,
        botNick: botProfiles.nickname,
        botAvatar: botProfiles.avatarUrl,
      })
      .from(battleParticipants)
      .leftJoin(users, eq(users.id, battleParticipants.userId))
      .leftJoin(botProfiles, eq(botProfiles.id, battleParticipants.botId))
      .where(inArray(battleParticipants.battleId, battleIds))
      .orderBy(asc(battleParticipants.slot));
    for (const r of rows) {
      const list = map.get(r.p.battleId) ?? [];
      list.push({
        ...r.p,
        u: r.userId
          ? {
              id: r.userId,
              shortId: r.shortId!,
              nickname: r.nickname!,
              avatarUrl: r.avatarUrl,
              level: r.level!,
            }
          : null,
        botNick: r.botNick,
        botAvatar: r.botAvatar,
      });
      map.set(r.p.battleId, list);
    }
    return map;
  }

  private toPlayers(
    b: BattleRow,
    parts: Array<
      ParticipantRow & {
        u: BattlePlayerDto['user'];
        botNick: string | null;
        botAvatar: string | null;
      }
    >,
    revealedTotals: number[] | null,
  ): Array<BattlePlayerDto | null> {
    const finished = b.status === 'finished';
    const slots: Array<BattlePlayerDto | null> = Array.from({ length: b.maxPlayers }, () => null);
    for (const p of parts) {
      slots[p.slot] = {
        slot: p.slot,
        team: p.team,
        user: p.u,
        bot: p.botId ? { nickname: p.botNick ?? 'Bot', avatarUrl: p.botAvatar } : null,
        total: finished ? p.totalValue : (revealedTotals?.[p.slot] ?? 0),
        isWinner: finished ? Boolean(p.isWinner) : null,
        payout: finished ? p.payoutValue : 0,
      };
    }
    return slots;
  }

  async get(battleId: string): Promise<BattleDto> {
    const [b] = await this.db.select().from(battles).where(eq(battles.id, battleId));
    if (!b) throw battleNotFound();
    const now = Date.now();
    const revealed = revealedRounds(b, now);
    const [players, rounds, dropRows, game] = await Promise.all([
      this.loadPlayers([b.id]),
      this.db
        .select({
          round: battleCases.roundIndex,
          caseId: battleCases.caseId,
          price: battleCases.price,
          slug: cases.slug,
          name: cases.name,
          imageUrl: cases.imageUrl,
          accentColor: cases.accentColor,
        })
        .from(battleCases)
        .innerJoin(cases, eq(cases.id, battleCases.caseId))
        .where(eq(battleCases.battleId, b.id))
        .orderBy(asc(battleCases.roundIndex)),
      revealed > 0
        ? this.db
            .select()
            .from(battleDrops)
            .where(and(eq(battleDrops.battleId, b.id), lte(battleDrops.roundIndex, revealed - 1)))
            .orderBy(asc(battleDrops.roundIndex), asc(battleDrops.slot))
        : Promise.resolve([] as DropRow[]),
      this.gameCode(b.gameId),
    ]);
    const drops = await this.toDropDtos(b, dropRows);
    const totals = Array.from({ length: b.maxPlayers }, () => 0);
    for (const d of drops) totals[d.slot]! += d.value;
    const finished = b.status === 'finished';
    const playerList = this.toPlayers(b, players.get(b.id) ?? [], totals);
    return {
      id: b.id,
      game,
      format: b.format,
      mode: b.mode,
      status: b.status,
      maxPlayers: b.maxPlayers,
      entryPrice: b.entryPrice,
      roundsCount: b.roundsCount,
      roundDurationMs: b.roundDurationMs,
      creatorId: b.creatorId,
      createdAt: b.createdAt.toISOString(),
      expiresAt: b.expiresAt.toISOString(),
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      finishedAt: b.finishedAt?.toISOString() ?? null,
      cancelReason: b.cancelReason,
      serverSeedHash: b.serverSeedHash,
      serverSeed: finished ? this.fairness.decrypt(b.serverSeedEnc) : null,
      clientSeed: b.clientSeed,
      players: playerList,
      rounds: rounds.map((r): BattleRoundCaseDto => ({
        round: r.round,
        caseId: r.caseId,
        slug: r.slug,
        name: localize(r.name),
        imageUrl: r.imageUrl,
        accentColor: r.accentColor,
        price: r.price,
      })),
      drops,
      revealedRounds: revealed,
      winnerSlots: finished ? playerList.flatMap((p) => (p?.isWinner ? [p.slot] : [])) : null,
      winnerTeam: finished ? b.winnerTeam : null,
      totalValue: finished ? b.totalValue : totals.reduce((a, v) => a + v, 0),
      serverTime: new Date(now).toISOString(),
    };
  }

  private async toDropDtos(b: BattleRow, rows: DropRow[]): Promise<BattleDropDto[]> {
    if (!rows.length) return [];
    const itemMap = await this.catalog.getItemsByIds([...new Set(rows.map((d) => d.itemId))]);
    const finished = b.status === 'finished';
    return rows.flatMap((d) => {
      const item = itemMap.get(d.itemId);
      if (!item) return [];
      return [
        {
          round: d.roundIndex,
          slot: d.slot,
          item: { ...item, price: d.itemValue } satisfies ItemDto,
          value: d.itemValue,
          recipientSlot: finished ? d.recipientSlot : null,
        },
      ];
    });
  }

  /** Событие battle:round для воркера. */
  async roundEvent(battleId: string, round: number): Promise<BattleRoundEventDto | null> {
    const [b] = await this.db.select().from(battles).where(eq(battles.id, battleId));
    if (!b || b.status !== 'in_progress' || !b.startsAt) return null;
    const rows = await this.db
      .select()
      .from(battleDrops)
      .where(and(eq(battleDrops.battleId, battleId), eq(battleDrops.roundIndex, round)))
      .orderBy(asc(battleDrops.slot));
    return {
      battleId,
      round,
      spinStartAt: new Date(b.startsAt.getTime() + round * b.roundDurationMs).toISOString(),
      drops: await this.toDropDtos(b, rows),
    };
  }

  async list(game: GameRow, q: BattleListQuery, userId: string | null): Promise<BattleListDto> {
    const where: SQL[] = [eq(battles.gameId, game.id)];
    if (q.status === 'active') where.push(inArray(battles.status, ['waiting', 'in_progress']));
    else where.push(eq(battles.status, 'finished'));
    if (q.format) where.push(eq(battles.format, q.format));
    if (q.mode) where.push(eq(battles.mode, q.mode));
    if (q.minPrice !== undefined) where.push(gte(battles.entryPrice, q.minPrice));
    if (q.maxPrice !== undefined) where.push(lte(battles.entryPrice, q.maxPrice));
    if (q.mine === '1') {
      if (!userId) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      where.push(
        sql`exists (select 1 from ${battleParticipants} bp where bp.battle_id = ${battles.id} and bp.user_id = ${userId})`,
      );
    }
    const cond = and(...where);
    const order =
      q.status === 'active'
        ? [sql`case when ${battles.status} = 'waiting' then 0 else 1 end`, desc(battles.createdAt)]
        : [desc(battles.finishedAt)];
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(battles)
        .where(cond)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(battles).where(cond),
    ]);
    return {
      items: await this.toListItems(rows, game.code),
      total: agg?.total ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async listItem(battleId: string): Promise<BattleListItemDto | null> {
    const [b] = await this.db.select().from(battles).where(eq(battles.id, battleId));
    if (!b) return null;
    const [item] = await this.toListItems([b], await this.gameCode(b.gameId));
    return item ?? null;
  }

  private async toListItems(rows: BattleRow[], game: string): Promise<BattleListItemDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [players, caseRows] = await Promise.all([
      this.loadPlayers(ids),
      this.db
        .select({
          battleId: battleCases.battleId,
          caseId: battleCases.caseId,
          price: battleCases.price,
          slug: cases.slug,
          name: cases.name,
          imageUrl: cases.imageUrl,
          accentColor: cases.accentColor,
          n: count(),
        })
        .from(battleCases)
        .innerJoin(cases, eq(cases.id, battleCases.caseId))
        .where(inArray(battleCases.battleId, ids))
        .groupBy(
          battleCases.battleId,
          battleCases.caseId,
          battleCases.price,
          cases.slug,
          cases.name,
          cases.imageUrl,
          cases.accentColor,
        )
        .orderBy(sql`min(${battleCases.roundIndex})`),
    ]);
    const casesBy = new Map<string, BattleListCaseDto[]>();
    for (const c of caseRows) {
      const list = casesBy.get(c.battleId) ?? [];
      list.push({
        caseId: c.caseId,
        slug: c.slug,
        name: localize(c.name),
        imageUrl: c.imageUrl,
        accentColor: c.accentColor,
        price: c.price,
        count: Number(c.n),
      });
      casesBy.set(c.battleId, list);
    }
    return rows.map((b) => {
      const finished = b.status === 'finished';
      const playerList = this.toPlayers(b, players.get(b.id) ?? [], null);
      return {
        id: b.id,
        game,
        format: b.format,
        mode: b.mode,
        status: b.status,
        maxPlayers: b.maxPlayers,
        entryPrice: b.entryPrice,
        roundsCount: b.roundsCount,
        createdAt: b.createdAt.toISOString(),
        startsAt: b.startsAt?.toISOString() ?? null,
        endsAt: b.endsAt?.toISOString() ?? null,
        players: playerList,
        cases: casesBy.get(b.id) ?? [],
        totalValue: finished ? b.totalValue : 0,
        winnerSlots: finished ? playerList.flatMap((p) => (p?.isWinner ? [p.slot] : [])) : null,
      };
    });
  }

  async proof(battleId: string): Promise<BattleProofDto> {
    const [b] = await this.db.select().from(battles).where(eq(battles.id, battleId));
    if (!b) throw battleNotFound();
    const finished = b.status === 'finished';
    const [parts, rounds] = await Promise.all([
      this.db
        .select({ slot: battleParticipants.slot, clientSeed: battleParticipants.clientSeed })
        .from(battleParticipants)
        .where(eq(battleParticipants.battleId, battleId))
        .orderBy(asc(battleParticipants.slot)),
      this.db
        .select({
          round: battleCases.roundIndex,
          revisionId: battleCases.revisionId,
          name: cases.name,
          contents: caseRevisions.contents,
        })
        .from(battleCases)
        .innerJoin(cases, eq(cases.id, battleCases.caseId))
        .innerJoin(caseRevisions, eq(caseRevisions.id, battleCases.revisionId))
        .where(eq(battleCases.battleId, battleId))
        .orderBy(asc(battleCases.roundIndex)),
    ]);
    const drops = finished
      ? await this.db
          .select()
          .from(battleDrops)
          .where(eq(battleDrops.battleId, battleId))
          .orderBy(asc(battleDrops.roundIndex), asc(battleDrops.slot))
      : [];
    const winners = finished
      ? (
          await this.db
            .select({ slot: battleParticipants.slot })
            .from(battleParticipants)
            .where(
              and(eq(battleParticipants.battleId, battleId), eq(battleParticipants.isWinner, true)),
            )
        ).map((r) => r.slot)
      : null;
    const itemIds = [...new Set(rounds.flatMap((r) => r.contents.map((e) => e.itemId)))];
    const itemMap = await this.catalog.getItemsByIds(itemIds);
    return {
      type: 'battle',
      id: b.id,
      revealed: finished,
      serverSeed: finished ? this.fairness.decrypt(b.serverSeedEnc) : null,
      serverSeedHash: b.serverSeedHash,
      clientSeed: b.clientSeed,
      slotSeeds: b.clientSeed ? parts.map((p) => p.clientSeed) : [],
      format: b.format,
      mode: b.mode,
      tiebreakRoll: finished ? b.tiebreakRoll : null,
      winnerSlots: winners?.sort((x, y) => x - y) ?? null,
      rounds: rounds.map((r) => ({
        round: r.round,
        caseName: localize(r.name),
        contents: r.contents.map((e) => ({
          itemId: e.itemId,
          odds: e.odds,
          name: itemMap.get(e.itemId)?.fullName ?? e.itemId,
          price: itemMap.get(e.itemId)?.price ?? 0,
        })),
        drops: drops
          .filter((d) => d.roundIndex === r.round)
          .map((d) => ({ slot: d.slot, itemId: d.itemId, ticket: d.ticket, value: d.itemValue })),
      })),
      createdAt: b.createdAt.toISOString(),
    };
  }

  /** Сколько баттлов пользователь выиграл в игре (для профиля). */
  async wonCount(userId: string, gameId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(battleParticipants)
      .innerJoin(battles, eq(battles.id, battleParticipants.battleId))
      .where(
        and(
          eq(battleParticipants.userId, userId),
          eq(battleParticipants.isWinner, true),
          eq(battles.gameId, gameId),
          eq(battles.status, 'finished'),
        ),
      );
    return row?.value ?? 0;
  }
}
