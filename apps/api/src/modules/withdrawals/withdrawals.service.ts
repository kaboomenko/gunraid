import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  authIdentities,
  deposits,
  games,
  inventoryEvents,
  newId,
  userAccessLog,
  userGameProfiles,
  userItems,
  users,
  withdrawalEvents,
  withdrawals,
  type Db,
  type DbOrTx,
  type WithdrawalFlags,
  type WithdrawalStatus,
} from '@gunraid/db';
import type {
  AdminWithdrawalDto,
  Cs2StubEvent,
  WithdrawalDto,
  WithdrawalListingBody,
  WithdrawalRequirementsDto,
  WithdrawalStatusCode,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, gte, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { providerForGame, RETURN_STATUSES, TRANSITIONS } from './withdrawal-providers.js';

type Row = typeof withdrawals.$inferSelect;
type Actor = { type: 'user' | 'admin' | 'system' | 'provider'; id: string | null };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const notFound = () => new AppError('WITHDRAWAL_NOT_FOUND', 404);

export interface WithdrawalContext {
  ip: string | null;
  deviceId: string | null;
}

/**
 * Вывод предметов (гемы не выводятся). Заявка блокирует предмет (статус «на выводе»), дальше —
 * ручное подтверждение оператором и шаги провайдера. Переходы статусов — под блокировкой строки вывода.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Требования ----------

  private async depositedGems(userId: string, tx: DbOrTx = this.db): Promise<number> {
    const [row] = await tx
      .select({ sum: sql<number>`coalesce(sum(${deposits.gemsAmount}), 0)::bigint` })
      .from(deposits)
      .where(and(eq(deposits.userId, userId), eq(deposits.status, 'succeeded')));
    return Number(row?.sum ?? 0);
  }

  private async usedToday(userId: string, tx: DbOrTx = this.db): Promise<number> {
    const [row] = await tx
      .select({ sum: sql<number>`coalesce(sum(${withdrawals.value}), 0)::bigint` })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, userId),
          gte(withdrawals.createdAt, new Date(Date.now() - DAY)),
          notInArray(withdrawals.status, RETURN_STATUSES),
        ),
      );
    return Number(row?.sum ?? 0);
  }

  async requirements(userId: string, game: GameRow): Promise<WithdrawalRequirementsDto> {
    const [af, ws] = await Promise.all([
      this.settings.get('antifraud'),
      this.settings.get('withdrawal'),
    ]);
    const [[u], [profile], identities, deposited, used] = await Promise.all([
      this.db
        .select({ createdAt: users.createdAt, firstDepositAt: users.firstDepositAt })
        .from(users)
        .where(eq(users.id, userId)),
      this.db
        .select()
        .from(userGameProfiles)
        .where(and(eq(userGameProfiles.userId, userId), eq(userGameProfiles.gameId, game.id))),
      this.db
        .select({ provider: authIdentities.provider })
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId)),
      this.depositedGems(userId),
      this.usedToday(userId),
    ]);
    const targetField = game.features.withdrawTarget;
    const targetSet = Boolean(targetField === 'trade_url' ? profile?.tradeUrl : profile?.playerId);
    const providers = identities.map((i) => i.provider);
    const availableAt = u?.firstDepositAt
      ? new Date(u.firstDepositAt.getTime() + af.withdrawDelayAfterFirstDepositHours * HOUR)
      : null;
    const isNew = u ? u.createdAt.getTime() > Date.now() - af.newAccountDays * DAY : false;
    return {
      game: game.code,
      targetField,
      targetSet,
      steamRequired: game.features.requiresSteam && !providers.includes('dev'),
      steamLinked: providers.includes('steam'),
      depositedGems: deposited,
      minDepositGems: af.minDepositsForWithdrawGems,
      availableAt:
        availableAt && availableAt.getTime() > Date.now() ? availableAt.toISOString() : null,
      newAccountLimit: isNew ? af.newAccountDailyWithdrawGems : null,
      newAccountUsedToday: used,
      so2GemsPerGold: ws.so2GemsPerGold,
      so2ListingTimeoutMinutes: ws.so2ListingTimeoutMinutes,
    };
  }

  // ---------- Заявка игрока ----------

  async request(
    tx: DbOrTx,
    userId: string,
    game: GameRow,
    userItemId: string,
    ctx: WithdrawalContext,
  ): Promise<string> {
    const provider = providerForGame(game.code);
    if (!provider) throw new AppError('WITHDRAW_NOT_ALLOWED', 403, { reason: 'game' });
    const [af, ws] = await Promise.all([
      this.settings.get('antifraud'),
      this.settings.get('withdrawal'),
    ]);
    const req = await this.requirements(userId, game);
    if (!req.targetSet) {
      throw new AppError('WITHDRAW_PROFILE_REQUIRED', 400, { field: req.targetField });
    }
    if (req.steamRequired && !req.steamLinked) throw new AppError('WITHDRAW_STEAM_REQUIRED', 400);
    if (req.depositedGems < af.minDepositsForWithdrawGems) {
      throw new AppError('WITHDRAW_DEPOSIT_REQUIRED', 403, { min: af.minDepositsForWithdrawGems });
    }
    if (req.availableAt) {
      throw new AppError('WITHDRAW_DELAY', 403, { availableAt: req.availableAt });
    }

    const [locked] = await this.inventory.lockAvailable(tx, userId, game.id, [userItemId]);
    if (!locked) throw new AppError('ITEM_NOT_AVAILABLE', 409);
    if (!locked.isWithdrawable) {
      throw new AppError('WITHDRAW_NOT_ALLOWED', 403, { reason: 'not_withdrawable' });
    }
    if (req.newAccountLimit !== null) {
      const used = await this.usedToday(userId, tx);
      if (used + locked.price > req.newAccountLimit) {
        throw new AppError('WITHDRAW_LIMIT', 403, { limit: req.newAccountLimit, used });
      }
    }

    const [[u], [profile]] = await Promise.all([
      tx
        .select({ isSuspicious: users.isSuspicious, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId)),
      tx
        .select()
        .from(userGameProfiles)
        .where(and(eq(userGameProfiles.userId, userId), eq(userGameProfiles.gameId, game.id))),
    ]);
    const sharedDevice = ctx.deviceId
      ? (
          await tx
            .select({ n: sql<number>`count(distinct ${userAccessLog.userId})::int` })
            .from(userAccessLog)
            .where(and(eq(userAccessLog.deviceId, ctx.deviceId), ne(userAccessLog.userId, userId)))
        )[0]?.n
      : 0;
    const flags: WithdrawalFlags = {
      suspicious: Boolean(u?.isSuspicious),
      newAccount: req.newAccountLimit !== null,
      sharedDevice: (sharedDevice ?? 0) > 0,
    };

    const id = newId();
    await tx
      .update(userItems)
      .set({
        status: 'withdrawing',
        statusChangedAt: sql`now()`,
        consumedRefType: 'withdrawal',
        consumedRefId: id,
      })
      .where(eq(userItems.id, locked.id));
    await tx.insert(inventoryEvents).values({
      userItemId: locked.id,
      userId,
      type: 'withdrawing',
      value: locked.price,
      refType: 'withdrawal',
      refId: id,
    });
    await tx.insert(withdrawals).values({
      id,
      userId,
      gameId: game.id,
      userItemId: locked.id,
      itemId: locked.itemId,
      value: locked.price,
      provider: provider.code,
      target:
        req.targetField === 'trade_url'
          ? { tradeUrl: profile?.tradeUrl ?? undefined }
          : { playerId: profile?.playerId ?? undefined },
      priceGold:
        provider.code === 'so2_manual' && ws.so2GemsPerGold
          ? Math.ceil(locked.price / ws.so2GemsPerGold)
          : null,
      flags,
    });
    await tx.insert(withdrawalEvents).values({
      withdrawalId: id,
      fromStatus: null,
      toStatus: 'pending_review',
      actorType: 'user',
      actorId: userId,
    });
    await tx.insert(userAccessLog).values({
      userId,
      event: 'withdraw',
      ip: ctx.ip,
      deviceId: ctx.deviceId,
    });
    return id;
  }

  // ---------- Переходы ----------

  private async lockRow(tx: DbOrTx, id: string): Promise<Row> {
    const [row] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
    if (!row) throw notFound();
    return row;
  }

  private async transition(
    tx: DbOrTx,
    w: Row,
    to: WithdrawalStatus,
    actor: Actor,
    opts: { note?: string | null; patch?: Partial<typeof withdrawals.$inferInsert> } = {},
  ): Promise<void> {
    if (!(TRANSITIONS[w.status] ?? []).includes(to)) {
      throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { from: w.status, to });
    }
    await tx
      .update(withdrawals)
      .set({ ...opts.patch, status: to, updatedAt: sql`now()` })
      .where(eq(withdrawals.id, w.id));
    await tx.insert(withdrawalEvents).values({
      withdrawalId: w.id,
      fromStatus: w.status,
      toStatus: to,
      actorType: actor.type,
      actorId: actor.id,
      note: opts.note ?? null,
    });
    if (to === 'completed' || RETURN_STATUSES.includes(to)) {
      const back = to !== 'completed';
      await tx
        .update(userItems)
        .set({
          status: back ? 'in_inventory' : 'withdrawn',
          statusChangedAt: sql`now()`,
          consumedRefType: back ? null : 'withdrawal',
          consumedRefId: back ? null : w.id,
        })
        .where(and(eq(userItems.id, w.userItemId), eq(userItems.status, 'withdrawing')));
      await tx.insert(inventoryEvents).values({
        userItemId: w.userItemId,
        userId: w.userId,
        type: back ? 'returned' : 'withdrawn',
        value: w.value,
        refType: 'withdrawal',
        refId: w.id,
      });
    }
    const [g] = await tx.select({ code: games.code }).from(games).where(eq(games.id, w.gameId));
    await this.notifications.enqueue(tx, {
      userId: w.userId,
      type: 'withdrawal_status',
      params: { status: to },
      link: g ? `/${g.code}/profile?tab=withdrawals` : null,
    });
  }

  async cancel(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      if (w.userId !== userId) throw notFound();
      if (w.status !== 'pending_review' && w.status !== 'awaiting_listing') {
        throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { from: w.status });
      }
      await this.transition(tx, w, 'cancelled', { type: 'user', id: userId });
    });
  }

  async submitListing(userId: string, id: string, body: WithdrawalListingBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      if (w.userId !== userId) throw notFound();
      if (w.status !== 'awaiting_listing') {
        throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { from: w.status });
      }
      if (w.expiresAt && w.expiresAt.getTime() < Date.now()) {
        await this.transition(tx, w, 'expired', { type: 'system', id: null });
        return;
      }
      await this.transition(
        tx,
        w,
        'listing_submitted',
        { type: 'user', id: userId },
        {
          patch: {
            listing: {
              reference: body.reference,
              note: body.note,
              submittedAt: new Date().toISOString(),
            },
            externalId: body.reference,
          },
        },
      );
    });
  }

  // ---------- Оператор ----------

  async approve(
    adminId: string,
    id: string,
    priceGold: number | undefined,
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      if (w.status !== 'pending_review') {
        throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { from: w.status });
      }
      const ws = await this.settings.get('withdrawal');
      if (w.provider === 'so2_manual') {
        const gold = priceGold ?? w.priceGold;
        if (!gold) throw new AppError('VALIDATION_ERROR', 400, { field: 'priceGold' });
        await this.transition(
          tx,
          w,
          'awaiting_listing',
          { type: 'admin', id: adminId },
          {
            patch: {
              operatorId: adminId,
              priceGold: gold,
              expiresAt: new Date(Date.now() + ws.so2ListingTimeoutMinutes * 60_000),
            },
          },
        );
      } else {
        await this.transition(
          tx,
          w,
          'purchasing',
          { type: 'admin', id: adminId },
          {
            patch: { operatorId: adminId },
            note: 'ЗАГЛУШКА: покупка на P2P-маркете имитируется',
          },
        );
      }
      await this.audit.log(
        {
          actorId: adminId,
          action: 'withdrawal.approve',
          entityType: 'withdrawal',
          entityId: id,
          after: { priceGold },
          ip,
        },
        tx,
      );
    });
  }

  async reject(adminId: string, id: string, reason: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      await this.transition(
        tx,
        w,
        'rejected',
        { type: 'admin', id: adminId },
        {
          note: reason,
          patch: { reason, operatorId: adminId },
        },
      );
      await this.audit.log(
        {
          actorId: adminId,
          action: 'withdrawal.reject',
          entityType: 'withdrawal',
          entityId: id,
          reason,
          ip,
        },
        tx,
      );
    });
  }

  /** Standoff 2: оператор купил лот игрока — вывод завершён. */
  async confirmPurchase(adminId: string, id: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      if (w.provider !== 'so2_manual' || w.status !== 'listing_submitted') {
        throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { from: w.status });
      }
      await this.transition(
        tx,
        w,
        'completed',
        { type: 'admin', id: adminId },
        {
          note: 'Покупка лота подтверждена оператором',
        },
      );
      await this.audit.log(
        {
          actorId: adminId,
          action: 'withdrawal.confirm_purchase',
          entityType: 'withdrawal',
          entityId: id,
          ip,
        },
        tx,
      );
    });
  }

  /** CS2-заглушка: события P2P-маркета, которые в будущем придут от реального провайдера. */
  async simulate(
    adminId: string,
    id: string,
    event: Cs2StubEvent,
    ip: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const w = await this.lockRow(tx, id);
      if (w.provider !== 'cs2_p2p_stub') {
        throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { provider: w.provider });
      }
      const ws = await this.settings.get('withdrawal');
      const actor: Actor = { type: 'provider', id: null };
      switch (event) {
        case 'trade_sent':
          await this.transition(tx, w, 'trade_sent', actor, {
            patch: { externalId: `stub-offer-${w.id.slice(0, 8)}` },
            note: 'ЗАГЛУШКА: оффер обмена отправлен',
          });
          break;
        case 'trade_accepted':
          await this.transition(tx, w, 'trade_accepted', actor, {
            patch: { protectedUntil: new Date(Date.now() + ws.cs2TradeProtectionDays * DAY) },
            note: 'ЗАГЛУШКА: обмен принят, идёт период защиты',
          });
          break;
        case 'trade_declined':
          await this.transition(tx, w, 'failed', actor, { note: 'ЗАГЛУШКА: обмен отклонён' });
          break;
        case 'purchase_failed':
          await this.transition(tx, w, 'failed', actor, { note: 'ЗАГЛУШКА: покупка не удалась' });
          break;
        case 'reverse':
          if (w.protectedUntil && w.protectedUntil.getTime() < Date.now()) {
            throw new AppError('WITHDRAWAL_INVALID_STATE', 409, { reason: 'protection_over' });
          }
          await this.transition(tx, w, 'reversed', actor, {
            note: 'ЗАГЛУШКА: сделку отменили в период защиты — предмет возвращён',
          });
          break;
        case 'complete':
          await this.transition(tx, w, 'completed', actor, { note: 'ЗАГЛУШКА: завершено вручную' });
          break;
      }
      await this.audit.log(
        {
          actorId: adminId,
          action: `withdrawal.simulate.${event}`,
          entityType: 'withdrawal',
          entityId: id,
          ip,
        },
        tx,
      );
    });
  }

  /** Воркер: просроченные лоты Standoff 2 и завершение CS2 после периода защиты. */
  async tick(): Promise<number> {
    const now = new Date();
    const due = await this.db
      .select({ id: withdrawals.id })
      .from(withdrawals)
      .where(
        sql`(${withdrawals.status} = 'awaiting_listing' and ${withdrawals.expiresAt} < ${now})
            or (${withdrawals.status} = 'trade_accepted' and ${withdrawals.protectedUntil} < ${now})`,
      )
      .limit(100);
    let done = 0;
    for (const { id } of due) {
      try {
        await this.db.transaction(async (tx) => {
          const w = await this.lockRow(tx, id);
          if (w.status === 'awaiting_listing' && w.expiresAt && w.expiresAt < now) {
            await this.transition(
              tx,
              w,
              'expired',
              { type: 'system', id: null },
              {
                note: 'Лот не выставлен вовремя',
              },
            );
            done++;
          } else if (w.status === 'trade_accepted' && w.protectedUntil && w.protectedUntil < now) {
            await this.transition(
              tx,
              w,
              'completed',
              { type: 'system', id: null },
              {
                note: 'Период защиты сделки завершён',
              },
            );
            done++;
          }
        });
      } catch (err) {
        this.logger.warn(`withdrawal ${id}: ${(err as Error).message}`);
      }
    }
    return done;
  }

  // ---------- Чтение ----------

  private async toDtos(rows: Row[]): Promise<WithdrawalDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [itemMap, events, gameRows] = await Promise.all([
      this.catalog.getItemsByIds([...new Set(rows.map((r) => r.itemId))]),
      this.db
        .select()
        .from(withdrawalEvents)
        .where(inArray(withdrawalEvents.withdrawalId, ids))
        .orderBy(asc(withdrawalEvents.createdAt), asc(withdrawalEvents.id)),
      this.db.select({ id: games.id, code: games.code }).from(games),
    ]);
    const gameCode = new Map(gameRows.map((g) => [g.id, g.code]));
    return rows.flatMap((r) => {
      const item = itemMap.get(r.itemId);
      if (!item) return [];
      return [
        {
          id: r.id,
          game: gameCode.get(r.gameId) ?? '',
          provider: r.provider,
          status: r.status as WithdrawalStatusCode,
          item,
          value: r.value,
          target: r.target,
          priceGold: r.priceGold,
          externalId: r.externalId,
          listing: r.listing,
          reason: r.reason,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          protectedUntil: r.protectedUntil?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          events: events
            .filter((e) => e.withdrawalId === r.id)
            .map((e) => ({
              fromStatus: (e.fromStatus as WithdrawalStatusCode | null) ?? null,
              toStatus: e.toStatus as WithdrawalStatusCode,
              actorType: e.actorType as 'user' | 'admin' | 'system' | 'provider',
              note: e.note,
              createdAt: e.createdAt.toISOString(),
            })),
        },
      ];
    });
  }

  async listForUser(userId: string, gameId: number | null, limit = 50): Promise<WithdrawalDto[]> {
    const where = gameId
      ? and(eq(withdrawals.userId, userId), eq(withdrawals.gameId, gameId))
      : eq(withdrawals.userId, userId);
    const rows = await this.db
      .select()
      .from(withdrawals)
      .where(where)
      .orderBy(desc(withdrawals.createdAt))
      .limit(limit);
    return this.toDtos(rows);
  }

  async getForUser(userId: string, id: string): Promise<WithdrawalDto> {
    const [row] = await this.db
      .select()
      .from(withdrawals)
      .where(and(eq(withdrawals.id, id), eq(withdrawals.userId, userId)));
    if (!row) throw notFound();
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  async adminList(
    statuses: string[] | null,
    page: number,
    pageSize: number,
  ): Promise<{ items: AdminWithdrawalDto[]; total: number }> {
    const where = statuses?.length
      ? inArray(withdrawals.status, statuses as WithdrawalStatus[])
      : undefined;
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(withdrawals)
        .where(where)
        .orderBy(desc(withdrawals.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(withdrawals).where(where),
    ]);
    return { items: await this.toAdminDtos(rows), total: agg?.n ?? 0 };
  }

  async adminGet(id: string): Promise<AdminWithdrawalDto> {
    const [row] = await this.db.select().from(withdrawals).where(eq(withdrawals.id, id));
    if (!row) throw notFound();
    const [dto] = await this.toAdminDtos([row]);
    return dto!;
  }

  private async toAdminDtos(rows: Row[]): Promise<AdminWithdrawalDto[]> {
    const base = await this.toDtos(rows);
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.userId, ...(r.operatorId ? [r.operatorId] : [])])),
    ];
    const people = userIds.length
      ? await this.db
          .select({
            id: users.id,
            shortId: users.shortId,
            nickname: users.nickname,
            isSuspicious: users.isSuspicious,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    const map = new Map(people.map((p) => [p.id, p]));
    return base.map((d, i) => {
      const r = rows.find((x) => x.id === d.id) ?? rows[i]!;
      const u = map.get(r.userId);
      const op = r.operatorId ? map.get(r.operatorId) : null;
      return {
        ...d,
        user: {
          id: r.userId,
          shortId: u?.shortId ?? 0,
          nickname: u?.nickname ?? '',
          isSuspicious: u?.isSuspicious ?? false,
        },
        flags: r.flags,
        operator: op ? { id: op.id, nickname: op.nickname } : null,
      };
    });
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(withdrawals)
      .where(inArray(withdrawals.status, ['pending_review', 'listing_submitted']));
    return row?.n ?? 0;
  }
}
