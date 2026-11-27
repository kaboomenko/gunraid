import { Inject, Injectable } from '@nestjs/common';
import {
  cargoPurchases,
  cargoRounds,
  cargoTemplates,
  games,
  items,
  newId,
  users,
  type Db,
  type DbOrTx,
} from '@gunraid/db';
import type {
  AdminCargoBody,
  AdminCargoDetailDto,
  AdminCargoIssue,
  AdminCargoParticipantDto,
  AdminCargoReconciliationDto,
  AdminCargoRoundDetailDto,
  AdminCargoRoundRowDto,
  AdminCargoRoundSummaryDto,
  AdminCargoRoundsQuery,
  AdminCargoRowDto,
  AdminPageDto,
  CargoLandReason,
  ItemDto,
} from '@gunraid/shared';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError, notFound } from '../../common/app-error.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { localize } from '../catalog/item-mapper.js';
import type { GameRow } from '../games/games.service.js';
import { toRoundDto } from './cargo.mapper.js';
import {
  CargoService,
  type CargoOpened,
  type RoundRow,
  type TemplateRow,
} from './cargo.service.js';

function requireItem(prizes: Map<string, ItemDto>, itemId: string): ItemDto {
  const item = prizes.get(itemId);
  if (!item) throw new Error(`cargo prize ${itemId} missing`);
  return item;
}

/** Поля шаблона для аудита: before и after одной формы — то, что лежит в БД после нормализации. */
function auditView(t: TemplateRow) {
  return {
    slug: t.slug,
    name: localize(t.name),
    imageUrl: t.imageUrl,
    prizeItemId: t.prizeItemId,
    seatsTotal: t.seatsTotal,
    seatPrice: t.seatPrice,
    perUserLimit: t.perUserLimit,
    durationMinutes: t.durationMinutes,
    minLevel: t.minLevel,
    depositWithinDays: t.depositWithinDays,
    minSeatsToLand: t.minSeatsToLand,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    archivedAt: t.archivedAt?.toISOString() ?? null,
  };
}

function toSummary(
  r: RoundRow,
  revenue: number,
  participants: number,
  prize: ItemDto,
): AdminCargoRoundSummaryDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    seatsSold: r.seatsSold,
    seatsTotal: r.seatsTotal,
    seatPrice: r.seatPrice,
    revenue,
    participants,
    prize,
    prizeValue: r.prizeValue,
    rtpNow: revenue > 0 ? r.prizeValue / revenue : null,
    minSeatsToLand: r.minSeatsToLand,
    landAttempts: r.landAttempts,
    lastLandError: r.lastLandError,
    lastLandErrorAt: r.lastLandErrorAt?.toISOString() ?? null,
    startedAt: r.startedAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    serverSeedHash: r.serverSeedHash,
  };
}

/**
 * Админка грузов: шаблоны (создание, правка, архив вместо удаления — D37), текущий раунд и история, участники
 * раунда, сверка. Раунды открывает и закрывает CargoService (openRound, closeWithRefund) — здесь их не дублируем.
 * Блокировки: правка и архив берут только строку шаблона (как openRound), порядок §2 не нарушается.
 */
@Injectable()
export class AdminCargoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    private readonly cargo: CargoService,
  ) {}

  // ---------- Шаблоны: запись ----------

  /**
   * Значения шаблона из тела. Приз — активный предмет этой игры (CARGO_PRIZE_INVALID); при правке тот же приз не
   * перепроверяется: выключенный в каталоге приз (issue PRIZE_INACTIVE) не должен мешать выключить или
   * переименовать груз. У бесплатного груза лимит всегда 1 (D9).
   */
  private async values(tx: DbOrTx, game: GameRow, body: AdminCargoBody, keepPrize: string | null) {
    const prizeItemId = body.prizeItemId.toLowerCase();
    if (prizeItemId !== keepPrize) {
      const [item] = await tx
        .select({ gameId: items.gameId, isActive: items.isActive })
        .from(items)
        .where(eq(items.id, prizeItemId));
      if (!item) throw new AppError('CARGO_PRIZE_INVALID', 400, { reason: 'missing' });
      if (item.gameId !== game.id) {
        throw new AppError('CARGO_PRIZE_INVALID', 400, { reason: 'game' });
      }
      if (!item.isActive) throw new AppError('CARGO_PRIZE_INVALID', 400, { reason: 'inactive' });
    }
    const perUserLimit = body.seatPrice === 0 ? 1 : (body.perUserLimit ?? null);
    if (perUserLimit !== null && perUserLimit > body.seatsTotal) {
      throw new AppError('VALIDATION_ERROR', 400, { field: 'perUserLimit' });
    }
    const minSeatsToLand = body.minSeatsToLand ?? null;
    if (minSeatsToLand !== null && minSeatsToLand > body.seatsTotal) {
      throw new AppError('VALIDATION_ERROR', 400, { field: 'minSeatsToLand' });
    }
    return {
      gameId: game.id,
      slug: body.slug,
      imageUrl: body.imageUrl,
      prizeItemId,
      seatsTotal: body.seatsTotal,
      seatPrice: body.seatPrice,
      perUserLimit,
      durationMinutes: body.durationMinutes,
      minLevel: body.minLevel ?? null,
      depositWithinDays: body.depositWithinDays ?? null,
      minSeatsToLand,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    };
  }

  /** Открытый раунд для события cargo:round (после коммита его шлёт контроллер). */
  private async opened(
    tx: DbOrTx,
    game: string,
    t: { id: string; slug: string },
    round: RoundRow | null,
  ): Promise<CargoOpened | null> {
    if (!round) return null;
    const prizes = await this.catalog.getItemsByIds([round.prizeItemId], tx);
    return {
      game,
      templateId: t.id,
      slug: t.slug,
      round: toRoundDto(round, requireItem(prizes, round.prizeItemId)),
    };
  }

  /** Новый шаблон; активный сразу получает раунд №1. Занятый slug (и у архивных, D37) → 409 CONFLICT. */
  async create(
    actorId: string,
    game: GameRow,
    body: AdminCargoBody,
    ip: string | null,
  ): Promise<{ id: string; opened: CargoOpened | null }> {
    const id = newId();
    try {
      return await this.db.transaction(async (tx) => {
        const values = await this.values(tx, game, body, null);
        const [t] = await tx
          .insert(cargoTemplates)
          .values({ id, ...values, name: { ru: body.name } })
          .returning();
        const round = values.isActive ? await this.cargo.openRound(tx, id) : null;
        await this.audit.log(
          {
            actorId,
            action: 'cargo.create',
            entityType: 'cargo',
            entityId: id,
            after: { ...auditView(t!), game: game.code, roundId: round?.id ?? null },
            ip,
          },
          tx,
        );
        return { id, opened: await this.opened(tx, game.code, t!, round) };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', 409, { field: 'slug' });
      throw err;
    }
  }

  /**
   * Правка шаблона (D18): снимок идущего раунда не меняется — приз, места, цена и условия действуют со следующего
   * раунда. Включённый шаблон без раунда получает его сразу. Шаблон другой игры → 404, архивный → 409.
   *
   * Адрес (slug) после создания не меняется → 409 CONFLICT {field: 'slug', reason: 'immutable'}. Сид узнаёт свои
   * грузы по (игра, slug): переименованный (и потом убранный в архив) сидовый груз следующая выкладка создала бы
   * заново, и тикер сразу открыл бы ему платный раунд (D37). На адрес ведут и ссылки: закладки, открытая страница
   * при покупке. Поэтому и занятого slug при правке не бывает.
   */
  async update(
    actorId: string,
    id: string,
    game: GameRow,
    body: AdminCargoBody,
    ip: string | null,
  ): Promise<{ opened: CargoOpened | null }> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(cargoTemplates)
        .where(eq(cargoTemplates.id, id))
        .for('update');
      if (!before || before.gameId !== game.id) throw notFound('CARGO_NOT_FOUND');
      if (before.archivedAt) throw new AppError('CONFLICT', 409, { reason: 'archived' });
      if (body.slug !== before.slug) {
        throw new AppError('CONFLICT', 409, { field: 'slug', reason: 'immutable' });
      }
      const values = await this.values(tx, game, body, before.prizeItemId);
      const [after] = await tx
        .update(cargoTemplates)
        .set({ ...values, name: { ...before.name, ru: body.name }, updatedAt: sql`now()` })
        .where(eq(cargoTemplates.id, id))
        .returning();
      // Шаблон уже заблокирован этой транзакцией; раунд есть — no-op, выключен или приз недоступен — null.
      const round = await this.cargo.openRound(tx, id);
      await this.audit.log(
        {
          actorId,
          action: 'cargo.update',
          entityType: 'cargo',
          entityId: id,
          before: auditView(before),
          after: { ...auditView(after!), roundId: round?.id ?? null },
          ip,
        },
        tx,
      );
      return { opened: await this.opened(tx, game.code, after!, round) };
    });
  }

  /**
   * Архив вместо удаления (D37): история раундов ссылается на шаблон. Только без открытого раунда (сначала
   * отменить: 409 CONFLICT {reason: 'round_open'}); повтор у архивного — без изменений. Под блокировкой шаблона, как
   * openRound: новый раунд между проверкой и архивом не появится.
   */
  async archive(actorId: string, id: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(cargoTemplates)
        .where(eq(cargoTemplates.id, id))
        .for('update');
      if (!before) throw notFound('CARGO_NOT_FOUND');
      if (before.archivedAt) return;
      const [open] = await tx
        .select({ id: cargoRounds.id })
        .from(cargoRounds)
        .where(and(eq(cargoRounds.templateId, id), eq(cargoRounds.status, 'open')))
        .limit(1);
      if (open) throw new AppError('CONFLICT', 409, { reason: 'round_open', roundId: open.id });
      const [after] = await tx
        .update(cargoTemplates)
        .set({ archivedAt: sql`now()`, isActive: false, updatedAt: sql`now()` })
        .where(eq(cargoTemplates.id, id))
        .returning();
      await this.audit.log(
        {
          actorId,
          action: 'cargo.archive',
          entityType: 'cargo',
          entityId: id,
          before: auditView(before),
          after: auditView(after!),
          ip,
        },
        tx,
      );
    });
  }

  // ---------- Шаблоны: чтение ----------

  /** Шаблоны игры по порядку; архивные — только с withArchived, после остальных. */
  async list(game: GameRow, withArchived: boolean): Promise<AdminCargoRowDto[]> {
    const where: SQL[] = [eq(cargoTemplates.gameId, game.id)];
    if (!withArchived) where.push(isNull(cargoTemplates.archivedAt));
    const rows = await this.db
      .select()
      .from(cargoTemplates)
      .where(and(...where))
      .orderBy(
        sql`${cargoTemplates.archivedAt} is not null`,
        asc(cargoTemplates.sortOrder),
        asc(cargoTemplates.createdAt),
        asc(cargoTemplates.id),
      );
    return this.toRows(rows.map((t) => ({ t, game: game.code })));
  }

  async get(id: string): Promise<AdminCargoDetailDto> {
    const [row] = await this.db
      .select({ t: cargoTemplates, game: games.code })
      .from(cargoTemplates)
      .innerJoin(games, eq(games.id, cargoTemplates.gameId))
      .where(eq(cargoTemplates.id, id));
    if (!row) throw notFound('CARGO_NOT_FOUND');
    const [dto] = await this.toRows([row]);
    return {
      ...dto!,
      createdAt: row.t.createdAt.toISOString(),
      updatedAt: row.t.updatedAt.toISOString(),
    };
  }

  /**
   * Строки шаблонов: открытый раунд с выручкой и числом участников, число приземлившихся раундов, проблема
   * (первая подходящая, см. AdminCargoIssue). Срок «застрял» — по часам БД.
   */
  private async toRows(list: Array<{ t: TemplateRow; game: string }>): Promise<AdminCargoRowDto[]> {
    if (!list.length) return [];
    const ids = list.map((x) => x.t.id);
    const [open, landed, prizeState] = await Promise.all([
      this.db
        .select({
          r: cargoRounds,
          revenue: sql<string>`coalesce(sum(${cargoPurchases.paid}), 0)`,
          participants: sql<number>`count(distinct ${cargoPurchases.userId})::int`,
          stuck: sql<boolean>`(${cargoRounds.seatsSold} >= ${cargoRounds.seatsTotal} or ${cargoRounds.endsAt} < now() - interval '1 minute')`,
        })
        .from(cargoRounds)
        .leftJoin(cargoPurchases, eq(cargoPurchases.roundId, cargoRounds.id))
        .where(and(inArray(cargoRounds.templateId, ids), eq(cargoRounds.status, 'open')))
        .groupBy(cargoRounds.id),
      this.db
        .select({ templateId: cargoRounds.templateId, n: count() })
        .from(cargoRounds)
        .where(and(inArray(cargoRounds.templateId, ids), eq(cargoRounds.status, 'landed')))
        .groupBy(cargoRounds.templateId),
      this.db
        .select({ id: items.id, gameId: items.gameId, isActive: items.isActive })
        .from(items)
        .where(inArray(items.id, [...new Set(list.map((x) => x.t.prizeItemId))])),
    ]);
    const openBy = new Map(open.map((o) => [o.r.templateId, o]));
    const landedBy = new Map(landed.map((l) => [l.templateId, l.n]));
    const stateBy = new Map(prizeState.map((p) => [p.id, p]));
    const prizes = await this.catalog.getItemsByIds([
      ...new Set([...list.map((x) => x.t.prizeItemId), ...open.map((o) => o.r.prizeItemId)]),
    ]);
    return list.map(({ t, game }): AdminCargoRowDto => {
      const o = openBy.get(t.id);
      const prize = requireItem(prizes, t.prizeItemId);
      const state = stateBy.get(t.prizeItemId);
      let issue: AdminCargoIssue | null = null;
      if (!t.archivedAt) {
        if (o?.stuck) issue = 'LANDING_STUCK';
        else if (state && !state.isActive) issue = 'PRIZE_INACTIVE';
        else if (state && state.gameId !== t.gameId) issue = 'PRIZE_GAME';
        else if (t.isActive && !o) issue = 'NO_ROUND';
      }
      return {
        id: t.id,
        game,
        slug: t.slug,
        name: localize(t.name),
        imageUrl: t.imageUrl,
        isActive: t.isActive,
        sortOrder: t.sortOrder,
        seatsTotal: t.seatsTotal,
        seatPrice: t.seatPrice,
        perUserLimit: t.perUserLimit,
        durationMinutes: t.durationMinutes,
        minLevel: t.minLevel,
        depositWithinDays: t.depositWithinDays,
        minSeatsToLand: t.minSeatsToLand,
        prize,
        rtp: t.seatPrice > 0 ? prize.price / (t.seatPrice * t.seatsTotal) : null,
        round: o
          ? toSummary(o.r, Number(o.revenue), o.participants, requireItem(prizes, o.r.prizeItemId))
          : null,
        roundsLanded: landedBy.get(t.id) ?? 0,
        issue,
        archivedAt: t.archivedAt?.toISOString() ?? null,
      };
    });
  }

  // ---------- Раунды ----------

  /** История раундов шаблона: новые первыми, фильтр по статусу. */
  async rounds(
    templateId: string,
    q: AdminCargoRoundsQuery,
  ): Promise<AdminPageDto<AdminCargoRoundRowDto>> {
    const [t] = await this.db
      .select({ id: cargoTemplates.id })
      .from(cargoTemplates)
      .where(eq(cargoTemplates.id, templateId));
    if (!t) throw notFound('CARGO_NOT_FOUND');
    const cond = and(
      eq(cargoRounds.templateId, templateId),
      q.status ? eq(cargoRounds.status, q.status) : undefined,
    );
    const [rows, [agg]] = await Promise.all([
      this.db
        .select()
        .from(cargoRounds)
        .where(cond)
        .orderBy(desc(cargoRounds.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(cargoRounds).where(cond),
    ]);
    return {
      items: await this.roundRows(rows),
      total: agg?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async roundRows(rows: RoundRow[]): Promise<AdminCargoRoundRowDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const winnerIds = [...new Set(rows.flatMap((r) => (r.winnerId ? [r.winnerId] : [])))];
    const [sums, winners, prizes] = await Promise.all([
      this.db
        .select({
          roundId: cargoPurchases.roundId,
          revenue: sql<string>`sum(${cargoPurchases.paid})`,
        })
        .from(cargoPurchases)
        .where(inArray(cargoPurchases.roundId, ids))
        .groupBy(cargoPurchases.roundId),
      winnerIds.length
        ? this.db
            .select({ id: users.id, shortId: users.shortId, nickname: users.nickname })
            .from(users)
            .where(inArray(users.id, winnerIds))
        : Promise.resolve([]),
      this.catalog.getItemsByIds([...new Set(rows.map((r) => r.prizeItemId))]),
    ]);
    const revenueBy = new Map(sums.map((s) => [s.roundId, Number(s.revenue)]));
    const winnerBy = new Map(winners.map((w) => [w.id, w]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      seatsSold: r.seatsSold,
      seatsTotal: r.seatsTotal,
      seatPrice: r.seatPrice,
      revenue: revenueBy.get(r.id) ?? 0,
      prize: requireItem(prizes, r.prizeItemId),
      prizeValue: r.prizeValue,
      winner: r.winnerId ? (winnerBy.get(r.winnerId) ?? null) : null,
      winningSeat: r.winningSeat,
      voidSeat: r.voidSeat,
      minSeatsToLand: r.minSeatsToLand,
      landReason: (r.landReason as CargoLandReason | null) ?? null,
      cancelReason: r.cancelReason,
      startedAt: r.startedAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      serverSeedHash: r.serverSeedHash,
    }));
  }

  /** Раунд с участниками: места, покупки, потрачено, первая покупка, вернули ли гемы. */
  async round(roundId: string): Promise<AdminCargoRoundDetailDto> {
    const [row] = await this.db
      .select({ r: cargoRounds, name: cargoTemplates.name, game: games.code })
      .from(cargoRounds)
      .innerJoin(cargoTemplates, eq(cargoTemplates.id, cargoRounds.templateId))
      .innerJoin(games, eq(games.id, cargoRounds.gameId))
      .where(eq(cargoRounds.id, roundId));
    if (!row) throw notFound('CARGO_ROUND_NOT_FOUND');
    const [[base], participants] = await Promise.all([
      this.roundRows([row.r]),
      this.participants(row.r.id),
    ]);
    return {
      ...base!,
      templateId: row.r.templateId,
      templateName: localize(row.name),
      game: row.game,
      participants,
    };
  }

  private async participants(roundId: string): Promise<AdminCargoParticipantDto[]> {
    const seats = sql<number>`sum(${cargoPurchases.count})::int`;
    const rows = await this.db
      .select({
        id: users.id,
        shortId: users.shortId,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
        seats,
        spent: sql<string>`sum(${cargoPurchases.paid})`,
        firstAt: sql<Date>`min(${cargoPurchases.createdAt})`.mapWith(cargoPurchases.createdAt),
        refunded: sql<boolean>`bool_or(${cargoPurchases.refundedAt} is not null)`,
        ranges: sql<
          Array<[number, number]>
        >`json_agg(json_build_array(${cargoPurchases.seatFrom}, ${cargoPurchases.seatTo}) order by ${cargoPurchases.seatFrom})`,
      })
      .from(cargoPurchases)
      .innerJoin(users, eq(users.id, cargoPurchases.userId))
      .where(eq(cargoPurchases.roundId, roundId))
      .groupBy(users.id)
      .orderBy(desc(seats), sql`min(${cargoPurchases.seatFrom})`);
    return rows.map((p) => ({
      user: { id: p.id, shortId: p.shortId, nickname: p.nickname, avatarUrl: p.avatarUrl },
      seats: p.seats,
      ranges: p.ranges,
      spent: Number(p.spent),
      firstAt: p.firstAt.toISOString(),
      refunded: p.refunded,
    }));
  }

  // ---------- Сверка ----------

  /** Сверка грузов с ledger (D39) по запросу админа; та же, что в часовой сверке воркера. */
  async reconciliation(): Promise<AdminCargoReconciliationDto> {
    const mismatches = await this.cargo.reconcile();
    return { ok: mismatches.length === 0, mismatches, checkedAt: new Date().toISOString() };
  }
}
