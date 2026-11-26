import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { items, type LocalizedText } from './catalog.js';
import { games } from './games.js';
import { userItems } from './inventory.js';
import { ledgerEntries } from './money.js';
import { users } from './users.js';

export const CARGO_ROUND_STATUSES = ['open', 'landed', 'expired', 'cancelled'] as const;
export const cargoRoundStatusEnum = pgEnum('cargo_round_status', CARGO_ROUND_STATUSES);

/** Шаблон ивентового груза (вид груза в игре): приз и правила следующих раундов. */
export const cargoTemplates = pgTable(
  'cargo_templates',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    slug: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    imageUrl: text().notNull(),
    prizeItemId: uuid()
      .notNull()
      .references(() => items.id),
    seatsTotal: integer().notNull(),
    /** Цена места в гемах; 0 — бесплатный груз. */
    seatPrice: bigint({ mode: 'number' }).notNull(),
    /** Мест на игрока за раунд; NULL — без лимита (у бесплатного всегда 1). */
    perUserLimit: integer(),
    durationMinutes: integer().notNull(),
    /** Условия участия против мультиаккаунтов (как у бесплатных кейсов и колеса). */
    minLevel: integer(),
    depositWithinDays: integer(),
    /** Минимум проданных мест для приземления по таймеру (D36); NULL — приземляется при ≥ 1 месте (бриф). */
    minSeatsToLand: integer(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    /** Архив (D37): шаблон только читается, slug остаётся занятым. */
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cargo_templates_game_slug_uq').on(t.gameId, t.slug),
    index('cargo_templates_game_sort_idx').on(t.gameId, t.sortOrder),
    // Потолок = CARGO_MAX_SEATS из @gunraid/shared (D38).
    check('cargo_templates_seats', sql`${t.seatsTotal} >= 2 AND ${t.seatsTotal} <= 10000`),
    check('cargo_templates_price', sql`${t.seatPrice} >= 0`),
    check('cargo_templates_limit', sql`${t.perUserLimit} IS NULL OR ${t.perUserLimit} >= 1`),
    // coalesce: при NULL выражение «price > 0 OR limit = 1» дало бы NULL, а CHECK пропускает NULL.
    check(
      'cargo_templates_free_limit',
      sql`${t.seatPrice} > 0 OR coalesce(${t.perUserLimit}, 0) = 1`,
    ),
    check('cargo_templates_duration', sql`${t.durationMinutes} >= 1`),
    check(
      'cargo_templates_min_seats',
      sql`${t.minSeatsToLand} IS NULL OR (${t.minSeatsToLand} >= 1 AND ${t.minSeatsToLand} <= ${t.seatsTotal})`,
    ),
    check('cargo_templates_archived', sql`${t.archivedAt} IS NULL OR NOT ${t.isActive}`),
  ],
);

/**
 * Раунд груза. Приз, места, цена и условия — снимок шаблона на момент старта. Server seed раунда
 * зашифрован, хэш публикуется сразу; client seed раунда (хэш списка покупок) и место — при приземлении.
 */
export const cargoRounds = pgTable(
  'cargo_rounds',
  {
    id: uuid().primaryKey(),
    templateId: uuid()
      .notNull()
      .references(() => cargoTemplates.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    number: integer().notNull(),
    status: cargoRoundStatusEnum().notNull().default('open'),
    prizeItemId: uuid()
      .notNull()
      .references(() => items.id),
    /** Цена приза на момент старта (RTP в админке). Выдаётся по текущей цене. */
    prizeValue: bigint({ mode: 'number' }).notNull(),
    seatsTotal: integer().notNull(),
    seatsSold: integer().notNull().default(0),
    seatPrice: bigint({ mode: 'number' }).notNull(),
    perUserLimit: integer(),
    minLevel: integer(),
    depositWithinDays: integer(),
    minSeatsToLand: integer(),
    serverSeedEnc: text().notNull(),
    serverSeedHash: text().notNull(),
    /** Client seed раунда: при приземлении, а также при отмене и закрытии по минимуму, если продано > 0 (D33). */
    clientSeed: text(),
    winningSeat: integer(),
    /** Место, которое выиграло бы, — у отменённых и закрытых по минимуму раундов с продажами (D33, D36). */
    voidSeat: integer(),
    winnerId: uuid().references(() => users.id),
    /** Без FK: покупки ссылаются на раунд, обратная ссылка дала бы цикл. */
    winnerPurchaseId: uuid(),
    userItemId: uuid().references(() => userItems.id),
    /** 'sold_out' | 'deadline' | 'min_seats'. */
    landReason: text(),
    cancelReason: text(),
    cancelledBy: uuid().references(() => users.id),
    /** Неудачные попытки приземления (D2, sweep): тикер пропускает раунд 5 мин после ошибки, админка — LANDING_STUCK. */
    landAttempts: integer().notNull().default(0),
    lastLandErrorAt: timestamp({ withTimezone: true }),
    lastLandError: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('cargo_rounds_template_number_uq').on(t.templateId, t.number),
    // У шаблона не больше одного открытого раунда. 'open' — значение нового типа, его можно использовать
    // в той же миграции (в отличие от значений, добавленных в существующий enum).
    uniqueIndex('cargo_rounds_one_open_uq')
      .on(t.templateId)
      .where(sql`${t.status} = 'open'`),
    index('cargo_rounds_due_idx')
      .on(t.endsAt)
      .where(sql`${t.status} = 'open'`),
    index('cargo_rounds_game_status_idx').on(t.gameId, t.status),
    check('cargo_rounds_seats', sql`${t.seatsSold} >= 0 AND ${t.seatsSold} <= ${t.seatsTotal}`),
    check('cargo_rounds_price', sql`${t.seatPrice} >= 0`),
    check(
      'cargo_rounds_min_seats',
      sql`${t.minSeatsToLand} IS NULL OR ${t.minSeatsToLand} <= ${t.seatsTotal}`,
    ),
  ],
);

/** Покупка мест: диапазон подряд идущих мест и client seed покупателя на момент покупки. */
export const cargoPurchases = pgTable(
  'cargo_purchases',
  {
    id: uuid().primaryKey(),
    roundId: uuid()
      .notNull()
      .references(() => cargoRounds.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    seatFrom: integer().notNull(),
    seatTo: integer().notNull(),
    count: integer().notNull(),
    paid: bigint({ mode: 'number' }).notNull(),
    clientSeed: text().notNull(),
    ledgerEntryId: bigint({ mode: 'number' }).references(() => ledgerEntries.id),
    refundedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cargo_purchases_round_seat_uq').on(t.roundId, t.seatFrom),
    // Одна запись ledger — одна покупка (NULL у бесплатных: в unique-индексе NULL не конфликтуют).
    uniqueIndex('cargo_purchases_ledger_uq').on(t.ledgerEntryId),
    index('cargo_purchases_round_user_idx').on(t.roundId, t.userId),
    index('cargo_purchases_user_idx').on(t.userId, t.createdAt),
    check(
      'cargo_purchases_range',
      sql`${t.seatFrom} >= 1 AND ${t.seatTo} >= ${t.seatFrom} AND ${t.count} = ${t.seatTo} - ${t.seatFrom} + 1`,
    ),
    check('cargo_purchases_paid', sql`${t.paid} >= 0`),
    // Платная покупка без списания и списание у бесплатной невозможны на уровне БД (D11).
    check('cargo_purchases_ledger', sql`(${t.paid} = 0) = (${t.ledgerEntryId} IS NULL)`),
    // Формат client seed — условие того, что строка для SHA-256 (D4) не требует экранирования.
    check('cargo_purchases_seed', sql`${t.clientSeed} ~ '^[A-Za-z0-9_-]{8,64}$'`),
  ],
);
