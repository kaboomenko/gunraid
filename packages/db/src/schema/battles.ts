import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { caseRevisions, cases } from './cases.js';
import { items } from './catalog.js';
import { games } from './games.js';
import { userItems } from './inventory.js';
import { users } from './users.js';

export const battleFormatEnum = pgEnum('battle_format', ['1v1', '1v1v1', '1v1v1v1', '2v2']);
export const battleModeEnum = pgEnum('battle_mode', ['classic', 'crazy']);
export const battleStatusEnum = pgEnum('battle_status', [
  'waiting',
  'in_progress',
  'finished',
  'cancelled',
]);

/**
 * Кейс-баттлы. У каждого баттла свой server seed (хэш публикуется при создании, сам seed — после завершения);
 * client seed баттла фиксируется при старте: SHA-256 от client seed'ов участников по слотам.
 */
export const battles = pgTable(
  'battles',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    creatorId: uuid()
      .notNull()
      .references(() => users.id),
    format: battleFormatEnum().notNull(),
    mode: battleModeEnum().notNull(),
    status: battleStatusEnum().notNull().default('waiting'),
    maxPlayers: smallint().notNull(),
    /** Стоимость участия в гемах = сумма цен кейсов. */
    entryPrice: bigint({ mode: 'number' }).notNull(),
    roundsCount: smallint().notNull(),
    roundDurationMs: integer().notNull(),
    serverSeedEnc: text().notNull(),
    serverSeedHash: text().notNull(),
    clientSeed: text(),
    tiebreakRoll: doublePrecision(),
    winnerTeam: smallint(),
    /** Сумма всех дропов (после старта). */
    totalValue: bigint({ mode: 'number' }).notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Лобби без соперников закрывается с возвратом после этого момента. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Момент заполнения последнего места. */
    startedAt: timestamp({ withTimezone: true }),
    /** Старт вращения первого раунда (после обратного отсчёта). */
    startsAt: timestamp({ withTimezone: true }),
    /** Конец последнего раунда — момент выдачи выигрыша. */
    endsAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
  },
  (t) => [
    index('battles_game_status_idx').on(t.gameId, t.status, t.createdAt),
    index('battles_creator_idx').on(t.creatorId, t.createdAt),
    check('battles_entry_positive', sql`${t.entryPrice} > 0`),
  ],
);

/** Кейс каждого раунда (ссылка на неизменяемую ревизию состава). */
export const battleCases = pgTable(
  'battle_cases',
  {
    battleId: uuid()
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    roundIndex: smallint().notNull(),
    caseId: uuid()
      .notNull()
      .references(() => cases.id),
    revisionId: uuid()
      .notNull()
      .references(() => caseRevisions.id),
    price: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.roundIndex] })],
);

/** Профили ботов, которыми создатель может заполнить свободные места. */
export const botProfiles = pgTable('bot_profiles', {
  id: smallint().primaryKey(),
  nickname: text().notNull(),
  avatarUrl: text(),
});

export const battleParticipants = pgTable(
  'battle_participants',
  {
    battleId: uuid()
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    slot: smallint().notNull(),
    team: smallint(),
    userId: uuid().references(() => users.id),
    botId: smallint().references(() => botProfiles.id),
    clientSeed: text().notNull(),
    paidAmount: bigint({ mode: 'number' }).notNull().default(0),
    totalValue: bigint({ mode: 'number' }).notNull().default(0),
    isWinner: boolean(),
    /** Стоимость предметов, доставшихся участнику. */
    payoutValue: bigint({ mode: 'number' }).notNull().default(0),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.slot] }),
    uniqueIndex('battle_participants_user_uq')
      .on(t.battleId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index('battle_participants_user_idx').on(t.userId, t.joinedAt),
    check('battle_participants_user_or_bot', sql`(${t.userId} IS NULL) <> (${t.botId} IS NULL)`),
  ],
);

/** Дропы по раундам и слотам; recipient_slot и user_item_id заполняются при выдаче выигрыша. */
export const battleDrops = pgTable(
  'battle_drops',
  {
    battleId: uuid()
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    roundIndex: smallint().notNull(),
    slot: smallint().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    itemValue: bigint({ mode: 'number' }).notNull(),
    roll: doublePrecision().notNull(),
    ticket: integer().notNull(),
    recipientSlot: smallint(),
    userItemId: uuid().references(() => userItems.id),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.roundIndex, t.slot] })],
);
