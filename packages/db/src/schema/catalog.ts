import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { games } from './games.js';
import { users } from './users.js';

/** Локализуемый текст из админки: {"ru": "…"}; новые языки — без изменения схемы. */
export type LocalizedText = Record<string, string>;

export const itemWearEnum = pgEnum('item_wear', ['FN', 'MW', 'FT', 'WW', 'BS']);
export const catalogImportStatusEnum = pgEnum('catalog_import_status', ['processing', 'done', 'failed']);

/** Редкости — по игре, в таблице (не в коде). */
export const rarities = pgTable(
  'rarities',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    color: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('rarities_game_code_uq').on(t.gameId, t.code),
    check('rarities_color_hex', sql`${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const itemTypes = pgTable('item_types', {
  id: smallint().primaryKey().generatedByDefaultAsIdentity(),
  code: text().notNull().unique(),
  name: jsonb().$type<LocalizedText>().notNull(),
  sortOrder: integer().notNull().default(0),
});

/** Модели оружия, ножей, перчаток — для фильтра «модель оружия». */
export const itemModels = pgTable(
  'item_models',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    typeId: smallint()
      .notNull()
      .references(() => itemTypes.id),
    code: text().notNull(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('item_models_game_code_uq').on(t.gameId, t.code)],
);

export const collections = pgTable(
  'collections',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    code: text().notNull(),
    name: text().notNull(),
    imageUrl: text(),
  },
  (t) => [uniqueIndex('collections_game_code_uq').on(t.gameId, t.code)],
);

/** Каталог: строка = конкретный продаваемый вариант (в CS2 износ и StatTrak — отдельные строки). */
export const items = pgTable(
  'items',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    typeId: smallint()
      .notNull()
      .references(() => itemTypes.id),
    modelId: integer().references(() => itemModels.id),
    rarityId: integer()
      .notNull()
      .references(() => rarities.id),
    collectionId: integer().references(() => collections.id),
    skinName: text().notNull(),
    fullName: text().notNull(),
    marketName: text().notNull(),
    imageUrl: text(),
    /** Цена в гемах. */
    price: bigint({ mode: 'number' }).notNull(),
    priceUpdatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    isStattrak: boolean().notNull().default(false),
    isSouvenir: boolean().notNull().default(false),
    wear: itemWearEnum(),
    floatMin: numeric({ precision: 6, scale: 5 }),
    floatMax: numeric({ precision: 6, scale: 5 }),
    isWithdrawable: boolean().notNull().default(true),
    inUpgrade: boolean().notNull().default(true),
    inContract: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('items_game_market_uq').on(t.gameId, t.marketName),
    index('items_game_active_price_idx').on(t.gameId, t.isActive, t.price),
    index('items_game_rarity_idx').on(t.gameId, t.rarityId),
    index('items_game_model_idx').on(t.gameId, t.modelId),
    index('items_full_name_trgm_idx').using('gin', sql`${t.fullName} gin_trgm_ops`),
    check('items_price_non_negative', sql`${t.price} >= 0`),
  ],
);

export const itemPriceHistory = pgTable(
  'item_price_history',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itemId: uuid()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    price: bigint({ mode: 'number' }).notNull(),
    sourcePrice: numeric({ precision: 20, scale: 8 }),
    sourceCurrency: text(),
    source: text().notNull(),
    actorId: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('item_price_history_item_idx').on(t.itemId, t.createdAt)],
);

export const catalogImports = pgTable('catalog_imports', {
  id: uuid().primaryKey(),
  gameId: smallint()
    .notNull()
    .references(() => games.id),
  actorId: uuid().references(() => users.id),
  fileName: text().notNull(),
  status: catalogImportStatusEnum().notNull().default('processing'),
  stats: jsonb().$type<Record<string, number>>().notNull().default({}),
  errors: jsonb().$type<Array<{ line: number; message: string }>>().notNull().default([]),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
});
