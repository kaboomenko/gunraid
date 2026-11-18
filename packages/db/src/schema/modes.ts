import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { fairSeeds } from './cases.js';
import { items } from './catalog.js';
import { games } from './games.js';
import { userItems } from './inventory.js';
import { users } from './users.js';

export const upgradeStakeTypeEnum = pgEnum('upgrade_stake_type', ['items', 'balance']);

/** Апгрейды: ставка предметами или гемами с баланса → целевой предмет с шансом (в миллионных). */
export const upgrades = pgTable(
  'upgrades',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    stakeType: upgradeStakeTypeEnum().notNull(),
    /** Гемы с баланса (0 при ставке предметами). */
    stakeAmount: bigint({ mode: 'number' }).notNull().default(0),
    /** Итоговая ценность ставки в гемах. */
    stakeValue: bigint({ mode: 'number' }).notNull(),
    targetItemId: uuid()
      .notNull()
      .references(() => items.id),
    targetPrice: bigint({ mode: 'number' }).notNull(),
    chance: integer().notNull(),
    commission: numeric({ precision: 6, scale: 4 }).notNull(),
    maxChance: numeric({ precision: 6, scale: 4 }).notNull(),
    fairSeedId: uuid()
      .notNull()
      .references(() => fairSeeds.id),
    nonce: integer().notNull(),
    roll: integer().notNull(),
    isWin: boolean().notNull(),
    resultUserItemId: uuid().references(() => userItems.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('upgrades_user_idx').on(t.userId, t.createdAt),
    index('upgrades_created_idx').on(t.createdAt),
  ],
);

export const upgradeStakeItems = pgTable(
  'upgrade_stake_items',
  {
    upgradeId: uuid()
      .notNull()
      .references(() => upgrades.id, { onDelete: 'cascade' }),
    userItemId: uuid()
      .notNull()
      .references(() => userItems.id),
    value: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.upgradeId, t.userItemId] })],
);

/** Контракты: 3–10 предметов → один предмет по множителю k ∈ [kMin, kMax]. */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    inputValue: bigint({ mode: 'number' }).notNull(),
    kMin: numeric({ precision: 10, scale: 4 }).notNull(),
    kMax: numeric({ precision: 10, scale: 4 }).notNull(),
    gamma: doublePrecision().notNull(),
    commission: numeric({ precision: 6, scale: 4 }).notNull(),
    fairSeedId: uuid()
      .notNull()
      .references(() => fairSeeds.id),
    nonce: integer().notNull(),
    roll: doublePrecision().notNull(),
    multiplier: doublePrecision().notNull(),
    targetValue: bigint({ mode: 'number' }).notNull(),
    resultItemId: uuid()
      .notNull()
      .references(() => items.id),
    resultValue: bigint({ mode: 'number' }).notNull(),
    resultUserItemId: uuid().references(() => userItems.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contracts_user_idx').on(t.userId, t.createdAt),
    index('contracts_created_idx').on(t.createdAt),
  ],
);

export const contractItems = pgTable(
  'contract_items',
  {
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    userItemId: uuid()
      .notNull()
      .references(() => userItems.id),
    value: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.userItemId] })],
);
