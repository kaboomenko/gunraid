import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { items } from './catalog.js';
import { games } from './games.js';
import { userItems } from './inventory.js';
import { users } from './users.js';

/**
 * CS2 (P2P-маркет, сейчас заглушка): pending_review → purchasing → trade_sent → trade_accepted → completed;
 *   ответвления: rejected, failed, cancelled, reversed (отмена сделки в период защиты).
 * Standoff 2 (ручной поток): pending_review → awaiting_listing → listing_submitted → completed;
 *   ответвления: rejected, expired (не выставил лот вовремя), cancelled.
 * При rejected / failed / cancelled / expired / reversed предмет возвращается в инвентарь.
 */
export const WITHDRAWAL_STATUSES = [
  'pending_review',
  'purchasing',
  'trade_sent',
  'trade_accepted',
  'awaiting_listing',
  'listing_submitted',
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'reversed',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const withdrawalStatusEnum = pgEnum('withdrawal_status', WITHDRAWAL_STATUSES);

export interface WithdrawalFlags {
  suspicious?: boolean;
  newAccount?: boolean;
  sharedDevice?: boolean;
}

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    userItemId: uuid()
      .notNull()
      .references(() => userItems.id),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    /** Стоимость предмета в гемах на момент заявки. */
    value: bigint({ mode: 'number' }).notNull(),
    provider: text().notNull(),
    status: withdrawalStatusEnum().notNull().default('pending_review'),
    /** Снимок trade-ссылки CS2 / ID игрока Standoff 2 на момент заявки. */
    target: jsonb().$type<{ tradeUrl?: string; playerId?: string }>().notNull(),
    /** Standoff 2: цена лота в золоте. */
    priceGold: integer(),
    /** Внешний ID: оффер обмена / лот на рынке. */
    externalId: text(),
    listing: jsonb().$type<{ reference?: string; note?: string; submittedAt?: string }>(),
    operatorId: uuid().references(() => users.id),
    reason: text(),
    flags: jsonb().$type<WithdrawalFlags>().notNull().default({}),
    /** Standoff 2: срок, до которого игрок должен выставить лот. */
    expiresAt: timestamp({ withTimezone: true }),
    /** CS2: окончание периода, в течение которого сделку могут отменить. */
    protectedUntil: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('withdrawals_status_idx').on(t.status, t.createdAt),
    index('withdrawals_user_idx').on(t.userId, t.createdAt),
  ],
);

/** История статусов вывода. */
export const withdrawalEvents = pgTable(
  'withdrawal_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    withdrawalId: uuid()
      .notNull()
      .references(() => withdrawals.id, { onDelete: 'cascade' }),
    fromStatus: withdrawalStatusEnum(),
    toStatus: withdrawalStatusEnum().notNull(),
    actorType: text().notNull(),
    actorId: uuid().references(() => users.id),
    note: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('withdrawal_events_withdrawal_idx').on(t.withdrawalId, t.createdAt)],
);
