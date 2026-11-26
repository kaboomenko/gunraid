import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  cargoPurchases,
  cargoRounds,
  cargoTemplates,
  deposits,
  games,
  items,
  newId,
  users,
  type Db,
  type DbOrTx,
  type Tx,
} from '@gunraid/db';
import {
  cargoClientSeed,
  cargoSeatOwner,
  cargoSeatsSold,
  cargoWinningSeat,
  sha256Hex,
} from '@gunraid/game-core';
import {
  CARGO_REVEAL_DELAY_MS,
  CARGO_SLUG_RE,
  cargoImageVariant,
  type CargoAvailabilityDto,
  type CargoBlockReason,
  type CargoBuyBody,
  type CargoBuyResultDto,
  type CargoCardDto,
  type CargoDetailDto,
  type CargoLandReason,
  type CargoListDto,
  type CargoMismatchDto,
  type CargoMyPurchaseDto,
  type CargoProofDto,
  type CargoResultDto,
  type CargoRoundDto,
  type CargoWinnerDto,
  type ItemDto,
} from '@gunraid/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { errorText } from '../../common/pg-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { localize } from '../catalog/item-mapper.js';
import { FairnessService } from '../fairness/fairness.service.js';
import type { DropEventPayload } from '../feed/feed.handlers.js';
import type { GameRow } from '../games/games.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { reconcileCargo } from './cargo-recon.js';
import { toResultDto, toRoundDto, type RoundRow } from './cargo.mapper.js';

export type { RoundRow } from './cargo.mapper.js';
export type TemplateRow = typeof cargoTemplates.$inferSelect;

/** Кто смотрит груз (для доступности покупки). */
export interface CargoViewer {
  userId: string;
  adultConfirmed: boolean;
}

/** Итог завершения раунда; balances — новые балансы тех, кому вернули гемы (пусто у landed / expired без продаж). */
export interface CargoLanding {
  game: string;
  templateId: string;
  slug: string;
  result: CargoResultDto;
  next: CargoRoundDto | null;
  winnerId: string | null;
  balances: Array<{ userId: string; balance: number }>;
}

export interface CargoOpened {
  game: string;
  templateId: string;
  slug: string;
  round: CargoRoundDto;
}

export type CargoLandOutcome = CargoLanding | { notDue: true; msLeft: number } | null;

/** Закрытие без победителя с возвратом: минимум продаж по таймеру (воркер) или отмена админом (этап A). */
export type CargoCloseMode =
  | { status: 'expired' }
  | { status: 'cancelled'; actorId: string; reason: string; ip: string | null };

const DAY_MS = 86_400_000;
/** Сколько раундов тикер приземляет за проход. */
const SWEEP_BATCH = 50;

/** Пора приземлять: распродан или вышел срок (срок — по часам БД, не Node). */
const dueSql = () =>
  sql<boolean>`(${cargoRounds.seatsSold} >= ${cargoRounds.seatsTotal} or ${cargoRounds.endsAt} <= now())`;
/** Продано меньше минимума (D36); без минимума — false. */
const underMinSql = () =>
  sql<boolean>`(${cargoRounds.minSeatsToLand} is not null and ${cargoRounds.seatsSold} < ${cargoRounds.minSeatsToLand})`;

function requirePrize(prizes: Map<string, ItemDto>, itemId: string): ItemDto {
  const prize = prizes.get(itemId);
  if (!prize) throw new Error('cargo prize missing');
  return prize;
}

/**
 * Ивентовые грузы: раунды-розыгрыши одного приза среди купленных мест.
 *
 * Порядок блокировок (docs/architecture.md §5.1): кошельки (по возрастанию id) → строка раунда → строка шаблона.
 * Покупка: кошелёк покупателя → раунд → (приземление при распродаже) шаблон. Приземление воркером: раунд → шаблон
 * (кошельков не трогает: XP идёт через outbox). Закрытие с возвратом: кошельки платившим → раунд → шаблон.
 * Открытие раунда: только шаблон.
 *
 * Честность (D4): server seed раунда зашифрован, хэш публикуется с первой секунды; client seed раунда — SHA-256 от
 * списка покупок с client seed покупателей; выигравшее место — floor(HMAC(serverSeed, "{clientSeed}:0:0") × продано) + 1.
 */
@Injectable()
export class CargoService {
  private readonly logger = new Logger(CargoService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly fairness: FairnessService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Публичное чтение ----------

  /** Грузы игры с открытым раундом (выключенный шаблон доигрывает текущий раунд и виден до его конца, D16). */
  async list(game: GameRow): Promise<CargoListDto> {
    const rows = await this.db
      .select({ t: cargoTemplates, r: cargoRounds })
      .from(cargoTemplates)
      .innerJoin(
        cargoRounds,
        and(eq(cargoRounds.templateId, cargoTemplates.id), eq(cargoRounds.status, 'open')),
      )
      .where(eq(cargoTemplates.gameId, game.id))
      .orderBy(
        asc(cargoTemplates.sortOrder),
        asc(cargoTemplates.createdAt),
        asc(cargoTemplates.id),
      );
    const prizes = await this.catalog.getItemsByIds([...new Set(rows.map((x) => x.r.prizeItemId))]);
    const cards = rows.flatMap(({ t, r }): CargoCardDto[] => {
      const prize = prizes.get(r.prizeItemId);
      if (!prize) return [];
      return [
        {
          id: t.id,
          slug: t.slug,
          name: localize(t.name),
          imageUrl: t.imageUrl,
          isFree: r.seatPrice === 0,
          roundId: r.id,
          seatsTotal: r.seatsTotal,
          seatsSold: r.seatsSold,
          seatPrice: r.seatPrice,
          endsAt: r.endsAt.toISOString(),
          prize,
        },
      ];
    });
    return { items: cards, serverTime: new Date().toISOString() };
  }

  async detail(game: GameRow, slug: string, viewer: CargoViewer | null): Promise<CargoDetailDto> {
    if (!CARGO_SLUG_RE.test(slug)) throw notFound('CARGO_NOT_FOUND');
    const [t] = await this.db
      .select()
      .from(cargoTemplates)
      .where(and(eq(cargoTemplates.gameId, game.id), eq(cargoTemplates.slug, slug)))
      .limit(1);
    if (!t) throw notFound('CARGO_NOT_FOUND');
    const [open] = await this.db
      .select({ r: cargoRounds, live: sql<boolean>`${cargoRounds.endsAt} > now()` })
      .from(cargoRounds)
      .where(and(eq(cargoRounds.templateId, t.id), eq(cargoRounds.status, 'open')))
      .limit(1);
    // Нет раунда и шаблон выключен (в том числе архивный) — груза публично нет.
    if (!open && !t.isActive) throw notFound('CARGO_NOT_FOUND');
    const [last] = await this.db
      .select()
      .from(cargoRounds)
      .where(and(eq(cargoRounds.templateId, t.id), ne(cargoRounds.status, 'open')))
      .orderBy(desc(cargoRounds.number))
      .limit(1);
    const prizeIds = [open?.r.prizeItemId, last?.prizeItemId].filter((id): id is string =>
      Boolean(id),
    );
    const prizes = await this.catalog.getItemsByIds([...new Set(prizeIds)]);
    const round = open ? toRoundDto(open.r, requirePrize(prizes, open.r.prizeItemId)) : null;
    let noRound: CargoDetailDto['noRound'] = null;
    if (!open) noRound = (await this.prizeAvailable(this.db, t)) ? 'STARTING' : 'PRIZE_UNAVAILABLE';
    return {
      id: t.id,
      slug: t.slug,
      name: localize(t.name),
      imageUrl: t.imageUrl,
      isFree: (open?.r.seatPrice ?? t.seatPrice) === 0,
      round,
      noRound,
      availability: await this.availability(open?.r ?? null, open?.live ?? false, viewer),
      lastResult: last ? await this.resultOf(this.db, last, prizes) : null,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Доступность покупки. Места игрока и его покупки — при любой причине (участник, открывший страницу во время
   * приземления, видит свои места: от них шанс на карточке и «вы участвовали» в окне результата).
   */
  private async availability(
    r: RoundRow | null,
    live: boolean,
    viewer: CargoViewer | null,
  ): Promise<CargoAvailabilityDto> {
    let myPurchases: CargoMyPurchaseDto[] = [];
    if (r && viewer) myPurchases = await this.purchasesOf(this.db, r.id, viewer.userId);
    const mySeats = myPurchases.reduce((a, p) => a + p.seatTo - p.seatFrom + 1, 0);
    const res = (reason: CargoBlockReason | null, maxBuy: number): CargoAvailabilityDto => ({
      canBuy: reason === null,
      reason,
      mySeats,
      myPurchases,
      maxBuy,
    });
    if (!r) return res('UNAVAILABLE', 0);
    if (!live) return res('CLOSED', 0);
    const left = r.seatsTotal - r.seatsSold;
    if (left <= 0) return res('SOLD_OUT', 0);
    const limit = r.seatPrice === 0 ? 1 : r.perUserLimit;
    // Для гостя — как будто вошёл и ещё не покупал; для ADULT / LEVEL / NO_DEPOSIT — как без этих условий.
    if (!viewer) return res('LOGIN', limit === null ? left : Math.min(left, limit));
    const room = limit === null ? left : Math.max(0, Math.min(left, limit - mySeats));
    if (!viewer.adultConfirmed) return res('ADULT', room);
    if (r.minLevel && (await this.levelOf(this.db, viewer.userId)) < r.minLevel) {
      return res('LEVEL', room);
    }
    if (
      r.depositWithinDays &&
      !(await this.hasDepositWithin(this.db, viewer.userId, r.depositWithinDays))
    ) {
      return res('NO_DEPOSIT', room);
    }
    if (limit !== null && mySeats >= limit) return res('LIMIT', 0);
    return res(null, room);
  }

  // ---------- Покупка ----------

  /**
   * Покупка K мест в текущем раунде (в транзакции идемпотентного запроса). Места — подряд, под блокировкой строки
   * раунда; списание — через ledger. Если заняты все места, раунд приземляется в той же транзакции внутри
   * SAVEPOINT: ошибка приземления откатывает только его, покупка остаётся, раунд приземлит воркер (D2).
   */
  async buy(
    tx: Tx,
    userId: string,
    game: GameRow,
    slug: string,
    body: CargoBuyBody,
  ): Promise<CargoBuyResultDto> {
    if (!CARGO_SLUG_RE.test(slug)) throw notFound('CARGO_NOT_FOUND');
    const walletBalance = await this.ledger.lockWallet(tx, userId); // 1. кошелёк
    const [row] = await tx
      .select({
        r: cargoRounds,
        t: { id: cargoTemplates.id, slug: cargoTemplates.slug },
        live: sql<boolean>`${cargoRounds.endsAt} > now()`,
      })
      .from(cargoRounds)
      .innerJoin(cargoTemplates, eq(cargoTemplates.id, cargoRounds.templateId))
      .where(and(eq(cargoRounds.id, body.roundId), eq(cargoRounds.gameId, game.id)))
      .for('update', { of: cargoRounds }); // 2. раунд
    if (!row || row.t.slug !== slug) {
      const [t] = await tx
        .select({ id: cargoTemplates.id })
        .from(cargoTemplates)
        .where(and(eq(cargoTemplates.gameId, game.id), eq(cargoTemplates.slug, slug)))
        .limit(1);
      if (!t) throw notFound('CARGO_NOT_FOUND');
      throw new AppError('CARGO_ROUND_CLOSED', 409, { reason: 'stale' });
    }
    const r = row.r;
    if (r.status !== 'open') throw new AppError('CARGO_ROUND_CLOSED', 409, { reason: 'status' });
    if (!row.live) throw new AppError('CARGO_ROUND_CLOSED', 409, { reason: 'deadline' });
    const left = r.seatsTotal - r.seatsSold;
    if (body.count > left) throw new AppError('CARGO_SEATS_LEFT', 409, { left });
    if (r.minLevel && (await this.levelOf(tx, userId)) < r.minLevel) {
      throw new AppError('CARGO_CONDITIONS_NOT_MET', 403, { reason: 'LEVEL', level: r.minLevel });
    }
    if (r.depositWithinDays && !(await this.hasDepositWithin(tx, userId, r.depositWithinDays))) {
      throw new AppError('CARGO_CONDITIONS_NOT_MET', 403, {
        reason: 'NO_DEPOSIT',
        days: r.depositWithinDays,
      });
    }
    const myBefore = await this.purchasesOf(tx, r.id, userId);
    const mine = myBefore.reduce((a, p) => a + p.seatTo - p.seatFrom + 1, 0);
    const limit = r.seatPrice === 0 ? 1 : r.perUserLimit;
    if (limit !== null && mine + body.count > limit) {
      throw new AppError('CARGO_LIMIT_REACHED', 409, { limit, mine });
    }

    const purchaseId = newId();
    const seatFrom = r.seatsSold + 1;
    const seatTo = r.seatsSold + body.count;
    const paid = r.seatPrice * body.count;
    // Client seed покупки обязателен (D5): сервер не выбирает вклад покупателя; формат проверила схема.
    const clientSeed = body.clientSeed;
    let balance = walletBalance;
    let ledgerEntryId: number | null = null;
    if (paid > 0) {
      const p = await this.ledger.post(tx, {
        userId,
        type: 'cargo_entry',
        amount: -paid,
        refType: 'cargo_purchase',
        refId: purchaseId,
        idempotencyKey: `cargo:${purchaseId}`,
        meta: {
          roundId: r.id,
          templateId: row.t.id,
          game: game.code,
          seatFrom,
          seatTo,
          count: body.count,
          clientSeed,
          serverSeedHash: r.serverSeedHash,
        },
      });
      balance = p.balanceAfter;
      ledgerEntryId = p.entryId;
    }
    await tx.insert(cargoPurchases).values({
      id: purchaseId,
      roundId: r.id,
      userId,
      seatFrom,
      seatTo,
      count: body.count,
      paid,
      clientSeed,
      ledgerEntryId,
    });
    const [u] = await tx
      .update(cargoRounds)
      .set({ seatsSold: sql`${cargoRounds.seatsSold} + ${body.count}` })
      .where(
        and(
          eq(cargoRounds.id, r.id),
          sql`${cargoRounds.seatsSold} + ${body.count} <= ${cargoRounds.seatsTotal}`,
        ),
      )
      .returning({ seatsSold: cargoRounds.seatsSold });
    // Недостижимо под блокировкой раунда (и CHECK cargo_rounds_seats), но не молча.
    if (!u) throw new AppError('CARGO_SEATS_LEFT', 409, { left });

    let landing: CargoLanding | null = null;
    if (u.seatsSold === r.seatsTotal) {
      try {
        landing = await tx.transaction((sp) =>
          this.landInTx(sp, { ...r, seatsSold: u.seatsSold }, 'sold_out'),
        );
      } catch (err) {
        // SAVEPOINT откатился, покупка остаётся. Всё — через tx (строка раунда уже заблокирована этой
        // транзакцией), не this.db: иначе второе соединение пула и запись, которая переживёт откат покупки.
        // Причина без SQL и параметров: в них победитель и исход раунда, который ещё open.
        const msg = errorText(err);
        this.logger.error(`cargo ${r.id}: landing failed: ${msg}`);
        await tx
          .update(cargoRounds)
          .set({
            landAttempts: sql`${cargoRounds.landAttempts} + 1`,
            lastLandErrorAt: sql`now()`,
            lastLandError: msg.slice(0, 500),
          })
          .where(eq(cargoRounds.id, r.id));
        await this.outbox.add(tx, 'cargo.deadline', { roundId: r.id }, 0);
      }
    }

    const prize =
      landing?.result.prize ??
      requirePrize(await this.catalog.getItemsByIds([r.prizeItemId], tx), r.prizeItemId);
    const round = toRoundDto(
      { ...r, seatsSold: u.seatsSold, status: landing ? landing.result.status : r.status },
      prize,
    );
    const leftAfter = left - body.count;
    const mineAfter = mine + body.count;
    const reason: CargoBlockReason | null =
      leftAfter <= 0 ? 'SOLD_OUT' : limit !== null && mineAfter >= limit ? 'LIMIT' : null;
    const maxBuy =
      reason !== null ? 0 : limit === null ? leftAfter : Math.min(leftAfter, limit - mineAfter);
    return {
      purchaseId,
      templateId: row.t.id,
      slug: row.t.slug,
      roundId: r.id,
      seatFrom,
      seatTo,
      count: body.count,
      paid,
      clientSeed,
      serverSeedHash: r.serverSeedHash,
      balance,
      round,
      availability: {
        canBuy: reason === null,
        reason,
        mySeats: mineAfter,
        myPurchases: [...myBefore, { seatFrom, seatTo, clientSeed }],
        maxBuy,
      },
      result: landing?.result ?? null,
      next: landing?.next ?? null,
    };
  }

  // ---------- Раунды ----------

  /**
   * Открывает раунд шаблона, если открытого нет (тикер, приземление, админка). Приз, места, цена, лимит и условия
   * снимаются в раунд (D18). Раунд не открывается у выключенного шаблона и при недоступном призе (D17).
   */
  async openRound(tx: DbOrTx, templateId: string): Promise<RoundRow | null> {
    const [t] = await tx
      .select()
      .from(cargoTemplates)
      .where(eq(cargoTemplates.id, templateId))
      .for('update');
    if (!t || !t.isActive || t.archivedAt) return null;
    const [open] = await tx
      .select({ id: cargoRounds.id })
      .from(cargoRounds)
      .where(and(eq(cargoRounds.templateId, t.id), eq(cargoRounds.status, 'open')))
      .limit(1);
    if (open) return null;
    const [item] = await tx
      .select({ gameId: items.gameId, isActive: items.isActive, price: items.price })
      .from(items)
      .where(eq(items.id, t.prizeItemId));
    if (!item || item.gameId !== t.gameId || !item.isActive) return null;
    const [agg] = await tx
      .select({ n: sql<number>`coalesce(max(${cargoRounds.number}), 0)::int` })
      .from(cargoRounds)
      .where(eq(cargoRounds.templateId, t.id));
    const serverSeed = this.fairness.newServerSeed();
    const [round] = await tx
      .insert(cargoRounds)
      .values({
        id: newId(),
        templateId: t.id,
        gameId: t.gameId,
        number: (agg?.n ?? 0) + 1,
        prizeItemId: t.prizeItemId,
        prizeValue: item.price,
        seatsTotal: t.seatsTotal,
        seatPrice: t.seatPrice,
        perUserLimit: t.seatPrice === 0 ? 1 : t.perUserLimit,
        minLevel: t.minLevel,
        depositWithinDays: t.depositWithinDays,
        minSeatsToLand: t.minSeatsToLand,
        serverSeedEnc: this.fairness.encrypt(serverSeed),
        serverSeedHash: sha256Hex(serverSeed),
        endsAt: sql`now() + make_interval(mins => ${t.durationMinutes})`,
      })
      .onConflictDoNothing()
      .returning();
    if (!round) return null;
    // Срок сверяется в SQL при обработке; тикер воркера — страховка (D3).
    await this.outbox.add(tx, 'cargo.deadline', { roundId: round.id }, t.durationMinutes * 60_000);
    return round;
  }

  /**
   * Приземление по сроку или распродаже (воркер, своя транзакция). Идемпотентно: раунд не open → null;
   * рано → {notDue}; продано меньше минимума (D36) → закрытие с возвратом.
   */
  async land(roundId: string): Promise<CargoLandOutcome> {
    try {
      const out = await this.db.transaction(
        async (tx): Promise<CargoLandOutcome | { refund: true }> => {
          const [row] = await tx
            .select({
              r: cargoRounds,
              due: dueSql(),
              underMin: underMinSql(),
              msLeft: sql<string>`greatest(0, extract(epoch from (${cargoRounds.endsAt} - now())) * 1000)`,
            })
            .from(cargoRounds)
            .where(eq(cargoRounds.id, roundId))
            .for('update');
          if (!row || row.r.status !== 'open') return null; // уже завершён / отменён — no-op
          if (!row.due) return { notDue: true, msLeft: Math.ceil(Number(row.msLeft)) };
          // D36: продано меньше минимума — возврат. Не здесь: под блокировкой раунда ledger.post взял бы кошельки
          // в обратном порядке. Транзакция закрывается, closeWithRefund берёт кошельки → раунд и проверяет заново.
          if (row.underMin && row.r.seatsSold > 0) return { refund: true };
          return this.landInTx(
            tx,
            row.r,
            row.r.seatsSold >= row.r.seatsTotal ? 'sold_out' : 'deadline',
          );
        },
      );
      if (out && 'refund' in out) return await this.closeWithRefund(roundId, { status: 'expired' });
      return out;
    } catch (err) {
      // Отдельным запросом (транзакция откатилась): тикер пропустит раунд 5 мин, админка покажет LANDING_STUCK.
      await this.db
        .update(cargoRounds)
        .set({
          landAttempts: sql`${cargoRounds.landAttempts} + 1`,
          lastLandErrorAt: sql`now()`,
          lastLandError: errorText(err).slice(0, 500),
        })
        .where(and(eq(cargoRounds.id, roundId), eq(cargoRounds.status, 'open')))
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Приземление под уже взятой блокировкой раунда: победитель среди проданных мест, приз в инвентарь, лента,
   * уведомление и XP через outbox, следующий раунд. Без продаж — `expired` без победителя (сид раскрыт).
   */
  private async landInTx(tx: DbOrTx, r: RoundRow, reason: CargoLandReason): Promise<CargoLanding> {
    const [tpl] = await tx
      .select({ t: cargoTemplates, game: games.code })
      .from(cargoTemplates)
      .innerJoin(games, eq(games.id, cargoTemplates.gameId))
      .where(eq(cargoTemplates.id, r.templateId))
      .for('update', { of: cargoTemplates }); // 3. шаблон
    if (!tpl) throw new Error(`cargo template ${r.templateId} missing`);
    const purchases = await tx
      .select({
        id: cargoPurchases.id,
        userId: cargoPurchases.userId,
        seatFrom: cargoPurchases.seatFrom,
        seatTo: cargoPurchases.seatTo,
        clientSeed: cargoPurchases.clientSeed,
        paid: cargoPurchases.paid,
      })
      .from(cargoPurchases)
      .where(eq(cargoPurchases.roundId, r.id))
      .orderBy(asc(cargoPurchases.seatFrom));
    const sold = cargoSeatsSold(purchases);
    if (sold !== r.seatsSold) {
      throw new Error(`cargo ${r.id}: seats_sold ${r.seatsSold} != purchases ${sold}`);
    }
    const prizes = await this.catalog.getItemsByIds([r.prizeItemId], tx);
    const prize = requirePrize(prizes, r.prizeItemId);
    const name = localize(tpl.t.name);

    let winner: CargoWinnerDto | null = null;
    let winnerId: string | null = null;
    let patch: Partial<typeof cargoRounds.$inferInsert>;
    if (sold === 0) {
      patch = { status: 'expired', landReason: 'deadline' };
    } else {
      const serverSeed = this.fairness.decrypt(r.serverSeedEnc);
      const cs = cargoClientSeed(purchases);
      const seat = cargoWinningSeat(serverSeed, cs, sold);
      const wp = cargoSeatOwner(purchases, seat);
      winnerId = wp.userId;
      const userItemId = await this.inventory.grant(tx, {
        userId: wp.userId,
        gameId: r.gameId,
        itemId: prize.id,
        value: prize.price,
        sourceType: 'cargo',
        sourceId: r.id,
      });
      patch = {
        status: 'landed',
        clientSeed: cs,
        winningSeat: seat,
        winnerId: wp.userId,
        winnerPurchaseId: wp.id,
        userItemId,
        landReason: reason,
      };
      winner = await this.winnerDto(tx, wp.userId);

      // Лента и уведомление — после анимации приземления на странице (D14, D15).
      const drop: DropEventPayload = {
        game: tpl.game,
        source: 'cargo',
        userId: wp.userId,
        caseSlug: null,
        caseName: name,
        caseImage: cargoImageVariant(tpl.t.imageUrl, 256),
        drops: [
          {
            id: userItemId,
            itemId: prize.id,
            skinName: prize.skinName,
            modelName: prize.modelName,
            imageUrl: prize.imageUrl,
            rarityColor: prize.rarity.color,
            price: prize.price,
          },
        ],
        createdAt: new Date(Date.now() + CARGO_REVEAL_DELAY_MS).toISOString(),
      };
      await this.outbox.add(
        tx,
        'drop.created',
        drop as unknown as Record<string, unknown>,
        CARGO_REVEAL_DELAY_MS,
      );
      await this.outbox.add(
        tx,
        'notification.create',
        {
          userId: wp.userId,
          type: 'cargo_won',
          params: { cargo: name, item: prize.fullName },
          link: `/${tpl.game}/profile`,
        },
        CARGO_REVEAL_DELAY_MS,
      );
      // XP — каждому платившему на сумму за раунд (D12); только у приземлившихся раундов.
      const paidBy = new Map<string, number>();
      for (const p of purchases) {
        if (p.paid > 0) paidBy.set(p.userId, (paidBy.get(p.userId) ?? 0) + p.paid);
      }
      for (const [userId, amount] of paidBy) {
        await this.outbox.add(tx, 'wager.placed', {
          userId,
          amount,
          sourceType: 'cargo_round',
          sourceId: r.id,
        });
      }
    }
    const [done] = await tx
      .update(cargoRounds)
      .set({ ...patch, finishedAt: sql`now()` })
      .where(and(eq(cargoRounds.id, r.id), eq(cargoRounds.status, 'open')))
      .returning();
    if (!done) throw new Error(`cargo ${r.id}: round is not open`);
    // Шаблон уже заблокирован этой транзакцией — повторная блокировка в openRound не ждёт.
    const next = tpl.t.isActive ? await this.openRound(tx, tpl.t.id) : null;
    return {
      game: tpl.game,
      templateId: tpl.t.id,
      slug: tpl.t.slug,
      result: toResultDto(done, tpl.t.id, prize, winner, false),
      next: next ? toRoundDto(next, await this.prizeOf(tx, next.prizeItemId, prizes)) : null,
      winnerId,
      balances: [],
    };
  }

  /**
   * Закрытие без победителя с возвратом всем платившим: минимум продаж по таймеру (D36, воркер) или отмена админом
   * (D33, этап A). Порядок блокировок — кошельки платившим (по возрастанию id) → раунд → шаблон; набор платившим
   * сверяется под блокировкой раунда, при изменении — повтор. Отменённый исход публичен: client seed раунда и место,
   * которое выиграло бы (`void_seat`), сохраняются. XP не начисляется (D12).
   */
  async closeWithRefund(roundId: string, mode: CargoCloseMode): Promise<CargoLanding | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.db.transaction(
        async (tx): Promise<'retry' | { done: CargoLanding | null }> => {
          const payers = async () =>
            (
              await tx
                .selectDistinct({ userId: cargoPurchases.userId })
                .from(cargoPurchases)
                .where(and(eq(cargoPurchases.roundId, roundId), gt(cargoPurchases.paid, 0)))
            )
              .map((p) => p.userId)
              .sort();
          const before = await payers();
          for (const u of before) await this.ledger.lockWallet(tx, u); // 1. кошельки по возрастанию
          const [row] = await tx
            .select({
              r: cargoRounds,
              t: {
                name: cargoTemplates.name,
                slug: cargoTemplates.slug,
                isActive: cargoTemplates.isActive,
              },
              game: games.code,
              due: dueSql(),
              underMin: underMinSql(),
            })
            .from(cargoRounds)
            .innerJoin(cargoTemplates, eq(cargoTemplates.id, cargoRounds.templateId))
            .innerJoin(games, eq(games.id, cargoRounds.gameId))
            .where(eq(cargoRounds.id, roundId))
            .for('update', { of: cargoRounds }); // 2. раунд
          if (!row) throw notFound('CARGO_ROUND_NOT_FOUND');
          // Дальше — канонический id из строки: тот же UUID может прийти прописными (z.string().uuid() их пропускает,
          // uuid в PostgreSQL сравнивается без учёта регистра), а ref_id и ключ возврата в ledger и entity_id в аудите —
          // текст; сверка D39 сравнивает ref_id с round_id::text.
          const id = row.r.id;
          if (row.r.status !== 'open') {
            if (mode.status === 'cancelled') throw new AppError('CARGO_ROUND_NOT_OPEN', 409);
            return { done: null }; // уже закрыт другим воркером
          }
          // Купили между чтением и блокировкой — кошелёк нового покупателя не заблокирован.
          if ((await payers()).join() !== before.join()) return 'retry';
          if (mode.status === 'expired' && !(row.due && row.underMin && row.r.seatsSold > 0)) {
            // Минимум уже набран (покупка, начатая до срока) или срок не вышел — обычный путь.
            return {
              done: row.due
                ? await this.landInTx(
                    tx,
                    row.r,
                    row.r.seatsSold >= row.r.seatsTotal ? 'sold_out' : 'deadline',
                  )
                : null,
            };
          }

          const purchases = await tx
            .select({
              userId: cargoPurchases.userId,
              seatFrom: cargoPurchases.seatFrom,
              seatTo: cargoPurchases.seatTo,
              clientSeed: cargoPurchases.clientSeed,
              paid: cargoPurchases.paid,
              refundedAt: cargoPurchases.refundedAt,
            })
            .from(cargoPurchases)
            .where(eq(cargoPurchases.roundId, id))
            .orderBy(asc(cargoPurchases.seatFrom));
          const sold = row.r.seatsSold;
          if (cargoSeatsSold(purchases) !== sold) {
            throw new Error(`cargo ${id}: seats_sold ${sold} != purchases`);
          }
          const sums = new Map<string, number>();
          for (const p of purchases) {
            if (p.paid > 0 && !p.refundedAt) sums.set(p.userId, (sums.get(p.userId) ?? 0) + p.paid);
          }
          const refunds = [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
          const name = localize(row.t.name);
          const balances: CargoLanding['balances'] = [];
          for (const [userId, amount] of refunds) {
            const p = await this.ledger.post(tx, {
              userId,
              type: 'cargo_refund',
              amount,
              refType: 'cargo_round',
              refId: id,
              idempotencyKey: `cargo_refund:${id}:${userId}`,
              actorId: mode.status === 'cancelled' ? mode.actorId : null,
              reason: mode.status === 'cancelled' ? mode.reason : null,
              meta: { templateId: row.r.templateId, game: row.game, why: mode.status },
            });
            balances.push({ userId, balance: p.balanceAfter });
            await this.notifications.enqueue(tx, {
              userId,
              type: 'cargo_refund',
              params: {
                gems: amount,
                cargo: name,
                why: mode.status === 'cancelled' ? 'cancelled' : 'min_seats',
              },
              link: `/${row.game}/cargo/${row.t.slug}`,
            });
          }
          await tx
            .update(cargoPurchases)
            .set({ refundedAt: sql`now()` })
            .where(
              and(
                eq(cargoPurchases.roundId, id),
                gt(cargoPurchases.paid, 0),
                isNull(cargoPurchases.refundedAt),
              ),
            );
          // D33: отменённый исход публичен — client seed раунда и место, которое выиграло бы (если продано > 0).
          const cs = sold > 0 ? cargoClientSeed(purchases) : null;
          const voidSeat = cs
            ? cargoWinningSeat(this.fairness.decrypt(row.r.serverSeedEnc), cs, sold)
            : null;
          const [closed] = await tx
            .update(cargoRounds)
            .set({
              status: mode.status,
              clientSeed: cs,
              voidSeat,
              landReason: mode.status === 'expired' ? 'min_seats' : null,
              cancelReason: mode.status === 'cancelled' ? mode.reason : null,
              cancelledBy: mode.status === 'cancelled' ? mode.actorId : null,
              finishedAt: sql`now()`,
            })
            .where(eq(cargoRounds.id, id))
            .returning();
          if (!closed) throw new Error(`cargo ${id}: close failed`);
          const next = row.t.isActive ? await this.openRound(tx, row.r.templateId) : null; // 3. шаблон
          if (mode.status === 'cancelled') {
            await this.audit.log(
              {
                actorId: mode.actorId,
                action: 'cargo_round.cancel',
                entityType: 'cargo_round',
                entityId: id,
                before: { status: 'open', seatsSold: sold },
                after: {
                  users: refunds.length,
                  gems: refunds.reduce((a, [, amount]) => a + amount, 0),
                  purchases: purchases.length,
                  clientSeed: cs,
                  voidSeat,
                  nextRoundId: next?.id ?? null,
                },
                reason: mode.reason,
                ip: mode.ip,
              },
              tx,
            );
          }
          const prizes = await this.catalog.getItemsByIds(
            [...new Set([closed.prizeItemId, next?.prizeItemId ?? closed.prizeItemId])],
            tx,
          );
          return {
            done: {
              game: row.game,
              templateId: closed.templateId,
              slug: row.t.slug,
              result: toResultDto(
                closed,
                closed.templateId,
                requirePrize(prizes, closed.prizeItemId),
                null,
                refunds.length > 0,
              ),
              next: next ? toRoundDto(next, requirePrize(prizes, next.prizeItemId)) : null,
              winnerId: null,
              balances,
            },
          };
        },
      );
      if (res !== 'retry') return res.done;
    }
    throw new AppError('CONFLICT', 409, { reason: 'cargo_busy' });
  }

  /** Обработчик outbox `cargo.deadline`: рано (часы Node и БД расходятся) — событие заново на остаток. */
  async onDeadline(roundId: string): Promise<CargoLanding | null> {
    const out = await this.land(roundId);
    if (out && 'notDue' in out) {
      await this.outbox.add(this.db, 'cargo.deadline', { roundId }, out.msLeft + 250);
      return null;
    }
    return out;
  }

  /** Открывает раунды активным шаблонам, у которых его нет (каждый — своя транзакция). */
  async ensureOpenRounds(): Promise<CargoOpened[]> {
    const rows = await this.db
      .select({ id: cargoTemplates.id, slug: cargoTemplates.slug, game: games.code })
      .from(cargoTemplates)
      .innerJoin(games, eq(games.id, cargoTemplates.gameId))
      .innerJoin(items, eq(items.id, cargoTemplates.prizeItemId))
      .where(
        and(
          eq(cargoTemplates.isActive, true),
          isNull(cargoTemplates.archivedAt),
          // Приз недоступен (D17) — не тратить транзакцию: openRound всё равно откажет.
          eq(items.isActive, true),
          eq(items.gameId, cargoTemplates.gameId),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(cargoRounds)
              .where(
                and(eq(cargoRounds.templateId, cargoTemplates.id), eq(cargoRounds.status, 'open')),
              ),
          ),
        ),
      )
      .orderBy(asc(cargoTemplates.gameId), asc(cargoTemplates.sortOrder));
    const opened: CargoOpened[] = [];
    for (const t of rows) {
      try {
        const o = await this.db.transaction(async (tx) => {
          const round = await this.openRound(tx, t.id);
          if (!round) return null;
          return {
            game: t.game,
            templateId: t.id,
            slug: t.slug,
            round: toRoundDto(round, await this.prizeOf(tx, round.prizeItemId)),
          } satisfies CargoOpened;
        });
        if (o) opened.push(o);
      } catch (err) {
        this.logger.error(`cargo template ${t.id}: open round failed: ${errorText(err)}`);
      }
    }
    return opened;
  }

  /**
   * Проход тикера воркера: приземлить просроченные и распроданные раунды (до 50, старые сроки — первыми; раунд,
   * который прямо сейчас приземляет другой воркер, пропускается; раунд с ошибкой приземления — не раньше чем через
   * 5 мин, его подхватит и повтор outbox с отступом), затем открыть недостающие раунды.
   */
  async sweep(): Promise<{ landed: CargoLanding[]; opened: CargoOpened[] }> {
    const due = await this.db
      .select({ id: cargoRounds.id })
      .from(cargoRounds)
      .where(
        and(
          eq(cargoRounds.status, 'open'),
          or(
            lte(cargoRounds.endsAt, sql`now()`),
            gte(cargoRounds.seatsSold, cargoRounds.seatsTotal),
          ),
          or(
            isNull(cargoRounds.lastLandErrorAt),
            lt(cargoRounds.lastLandErrorAt, sql`now() - interval '5 minutes'`),
          ),
        ),
      )
      .orderBy(asc(cargoRounds.endsAt))
      .limit(SWEEP_BATCH)
      .for('update', { skipLocked: true });
    const landed: CargoLanding[] = [];
    for (const { id } of due) {
      try {
        const out = await this.land(id); // ошибка одного не останавливает остальные; land() сам считает попытки
        if (out && !('notDue' in out)) landed.push(out);
      } catch (err) {
        this.logger.error(`cargo ${id}: sweep landing failed: ${errorText(err)}`);
      }
    }
    // Приземления уже закоммичены, и их событий никто не повторит (раунд не open: ни следующий проход, ни
    // cargo.deadline его не вернут), поэтому сбой открытия раундов не должен их терять — откроет следующий проход.
    let opened: CargoOpened[] = [];
    try {
      opened = await this.ensureOpenRounds();
    } catch (err) {
      this.logger.error(`cargo sweep: open rounds failed: ${errorText(err)}`);
    }
    return { landed, opened };
  }

  /** Победитель раунда (для inventory:update после покупки последнего места). */
  async winnerOf(roundId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ winnerId: cargoRounds.winnerId })
      .from(cargoRounds)
      .where(eq(cargoRounds.id, roundId));
    return row?.winnerId ?? null;
  }

  /**
   * Доказательство раунда (D4). Покупки — и у открытого раунда (без server seed по ним ничего не предсказать);
   * покупатели не раскрываются, `mine` — покупки того, кто смотрит. Размер ограничен потолком мест (D38).
   */
  async proof(roundId: string, viewerId: string | null): Promise<CargoProofDto> {
    const [row] = await this.db
      .select({ r: cargoRounds, name: cargoTemplates.name })
      .from(cargoRounds)
      .innerJoin(cargoTemplates, eq(cargoTemplates.id, cargoRounds.templateId))
      .where(eq(cargoRounds.id, roundId));
    if (!row) throw notFound('CARGO_ROUND_NOT_FOUND');
    const r = row.r;
    const [purchases, winnerRows, prizes] = await Promise.all([
      this.db
        .select({
          seatFrom: cargoPurchases.seatFrom,
          seatTo: cargoPurchases.seatTo,
          clientSeed: cargoPurchases.clientSeed,
          userId: cargoPurchases.userId,
        })
        .from(cargoPurchases)
        .where(eq(cargoPurchases.roundId, roundId))
        .orderBy(asc(cargoPurchases.seatFrom)),
      r.winnerId
        ? this.db
            .select({ shortId: users.shortId, nickname: users.nickname })
            .from(users)
            .where(eq(users.id, r.winnerId))
        : Promise.resolve([] as Array<{ shortId: number; nickname: string }>),
      this.catalog.getItemsByIds([r.prizeItemId]),
    ]);
    const prize = prizes.get(r.prizeItemId);
    const revealed = r.status !== 'open';
    return {
      type: 'cargo',
      id: r.id,
      cargoName: localize(row.name),
      number: r.number,
      status: r.status,
      revealed,
      serverSeed: revealed ? this.fairness.decrypt(r.serverSeedEnc) : null,
      serverSeedHash: r.serverSeedHash,
      clientSeed: r.clientSeed,
      purchases: purchases.map((p) => ({
        seatFrom: p.seatFrom,
        seatTo: p.seatTo,
        clientSeed: p.clientSeed,
        mine: viewerId !== null && p.userId === viewerId,
      })),
      seatsSold: r.seatsSold,
      seatsTotal: r.seatsTotal,
      minSeatsToLand: r.minSeatsToLand,
      landReason: (r.landReason as CargoLandReason | null) ?? null,
      winningSeat: r.winningSeat,
      voidSeat: r.voidSeat,
      winner: winnerRows[0] ?? null,
      prize: {
        itemId: r.prizeItemId,
        name: prize?.fullName ?? r.prizeItemId,
        price: prize?.price ?? r.prizeValue,
        imageUrl: prize?.imageUrl ?? null,
      },
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  }

  /** Сверка грузов с ledger (D39). */
  reconcile(): Promise<CargoMismatchDto[]> {
    return reconcileCargo(this.db);
  }

  // ---------- Вспомогательное ----------

  private async purchasesOf(
    tx: DbOrTx,
    roundId: string,
    userId: string,
  ): Promise<CargoMyPurchaseDto[]> {
    return tx
      .select({
        seatFrom: cargoPurchases.seatFrom,
        seatTo: cargoPurchases.seatTo,
        clientSeed: cargoPurchases.clientSeed,
      })
      .from(cargoPurchases)
      .where(and(eq(cargoPurchases.roundId, roundId), eq(cargoPurchases.userId, userId)))
      .orderBy(asc(cargoPurchases.seatFrom));
  }

  private async levelOf(tx: DbOrTx, userId: string): Promise<number> {
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    return u?.level ?? 0;
  }

  /** Пополнение за последние N дней (как DailyService.hasDepositWithin). */
  private async hasDepositWithin(tx: DbOrTx, userId: string, days: number): Promise<boolean> {
    const [row] = await tx
      .select({ id: deposits.id })
      .from(deposits)
      .where(
        and(
          eq(deposits.userId, userId),
          eq(deposits.status, 'succeeded'),
          gte(deposits.completedAt, new Date(Date.now() - days * DAY_MS)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Приз шаблона доступен для нового раунда: есть в каталоге, своей игры, включён (D17). */
  private async prizeAvailable(tx: DbOrTx, t: TemplateRow): Promise<boolean> {
    const [item] = await tx
      .select({ gameId: items.gameId, isActive: items.isActive })
      .from(items)
      .where(eq(items.id, t.prizeItemId));
    return Boolean(item && item.gameId === t.gameId && item.isActive);
  }

  private async prizeOf(
    tx: DbOrTx,
    itemId: string,
    known?: Map<string, ItemDto>,
  ): Promise<ItemDto> {
    const hit = known?.get(itemId);
    if (hit) return hit;
    return requirePrize(await this.catalog.getItemsByIds([itemId], tx), itemId);
  }

  private async winnerDto(tx: DbOrTx, userId: string): Promise<CargoWinnerDto | null> {
    const [u] = await tx
      .select({ shortId: users.shortId, nickname: users.nickname, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId));
    return u ?? null;
  }

  /** Итог завершённого раунда для детальной: победитель и были ли возвраты. */
  private async resultOf(
    tx: DbOrTx,
    r: RoundRow,
    prizes: Map<string, ItemDto>,
  ): Promise<CargoResultDto> {
    const [refund] = await tx
      .select({ id: cargoPurchases.id })
      .from(cargoPurchases)
      .where(and(eq(cargoPurchases.roundId, r.id), isNotNull(cargoPurchases.refundedAt)))
      .limit(1);
    return toResultDto(
      r,
      r.templateId,
      await this.prizeOf(tx, r.prizeItemId, prizes),
      r.winnerId ? await this.winnerDto(tx, r.winnerId) : null,
      Boolean(refund),
    );
  }
}
