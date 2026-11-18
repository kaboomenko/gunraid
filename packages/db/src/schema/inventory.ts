import { sql } from 'drizzle-orm';
import { bigint, index, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { items } from './catalog.js';
import { games } from './games.js';
import { users } from './users.js';

export const USER_ITEM_STATUSES = [
  'in_inventory',
  'sold',
  'withdrawing',
  'withdrawn',
  'used_upgrade',
  'used_contract',
  'lost_battle',
] as const;

export const ITEM_SOURCES = [
  'case',
  'upgrade',
  'contract',
  'battle',
  'wheel',
  'promo',
  'level_reward',
  'leaderboard',
  'admin',
  'seed',
] as const;

export const userItemStatusEnum = pgEnum('user_item_status', USER_ITEM_STATUSES);
export const itemSourceEnum = pgEnum('item_source', ITEM_SOURCES);

/** Экземпляры предметов у пользователей (инвентари раздельны по играм). */
export const userItems = pgTable(
  'user_items',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    status: userItemStatusEnum().notNull().default('in_inventory'),
    /** Цена в гемах на момент получения. */
    acquiredValue: bigint({ mode: 'number' }).notNull(),
    sourceType: itemSourceEnum().notNull(),
    sourceId: uuid(),
    acquiredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    consumedRefType: text(),
    consumedRefId: uuid(),
    soldValue: bigint({ mode: 'number' }),
  },
  (t) => [
    index('user_items_inventory_idx')
      .on(t.userId, t.gameId, t.acquiredAt)
      .where(sql`${t.status} = 'in_inventory'`),
    index('user_items_user_game_status_idx').on(t.userId, t.gameId, t.status, t.acquiredAt),
    index('user_items_source_idx').on(t.sourceType, t.sourceId),
  ],
);

/** Журнал движения предметов (получен, продан, выведен, использован…). */
export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userItemId: uuid()
      .notNull()
      .references(() => userItems.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    value: bigint({ mode: 'number' }).notNull(),
    refType: text(),
    refId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inventory_events_item_idx').on(t.userItemId),
    index('inventory_events_user_idx').on(t.userId, t.createdAt),
  ],
);
