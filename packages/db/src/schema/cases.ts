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
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { items, type LocalizedText } from './catalog.js';
import { games } from './games.js';
import { userItems } from './inventory.js';
import { users } from './users.js';

export const caseKindEnum = pgEnum('case_kind', ['paid', 'free']);
export const fairSeedStatusEnum = pgEnum('fair_seed_status', ['active', 'revealed']);

/** Пары сидов provably fair: server seed хранится зашифрованным, наружу — только SHA-256 хэш до раскрытия. */
export const fairSeeds = pgTable(
  'fair_seeds',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverSeedEnc: text().notNull(),
    serverSeedHash: text().notNull(),
    clientSeed: text().notNull(),
    /** Следующий nonce. */
    nonce: integer().notNull().default(0),
    status: fairSeedStatusEnum().notNull().default('active'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revealedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('fair_seeds_one_active_uq')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
    index('fair_seeds_user_idx').on(t.userId, t.createdAt),
  ],
);

export const caseCategories = pgTable(
  'case_categories',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    code: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('case_categories_game_code_uq').on(t.gameId, t.code)],
);

export const cases = pgTable(
  'cases',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    categoryId: integer()
      .notNull()
      .references(() => caseCategories.id),
    slug: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    description: jsonb().$type<LocalizedText>(),
    imageUrl: text(),
    accentColor: text().notNull().default('#C6FF00'),
    /** Цена в гемах; 0 — бесплатный кейс. */
    price: bigint({ mode: 'number' }).notNull(),
    kind: caseKindEnum().notNull().default('paid'),
    minLevel: integer(),
    cooldownSeconds: integer(),
    supplyTotal: integer(),
    supplyUsed: integer().notNull().default(0),
    availableFrom: timestamp({ withTimezone: true }),
    availableUntil: timestamp({ withTimezone: true }),
    currentRevisionId: uuid(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cases_game_slug_uq').on(t.gameId, t.slug),
    index('cases_game_category_idx').on(t.gameId, t.categoryId, t.sortOrder),
    check('cases_price_non_negative', sql`${t.price} >= 0`),
    check('cases_supply', sql`${t.supplyTotal} IS NULL OR ${t.supplyUsed} <= ${t.supplyTotal}`),
  ],
);

/** Редактируемый состав кейса. Шансы — целые в единицах 0,00001 % (сумма = 10 000 000). */
export const caseItems = pgTable(
  'case_items',
  {
    caseId: uuid()
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    odds: integer().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.itemId] }),
    check('case_items_odds_positive', sql`${t.odds} > 0`),
  ],
);

export interface RevisionEntry {
  itemId: string;
  odds: number;
}

/** Неизменяемые снимки состава: открытия ссылаются на ревизию, поэтому старые результаты остаются проверяемыми. */
export const caseRevisions = pgTable(
  'case_revisions',
  {
    id: uuid().primaryKey(),
    caseId: uuid()
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    contents: jsonb().$type<RevisionEntry[]>().notNull(),
    price: bigint({ mode: 'number' }).notNull(),
    rtp: numeric({ precision: 10, scale: 6 }),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('case_revisions_case_version_uq').on(t.caseId, t.version)],
);

export const caseOpenings = pgTable(
  'case_openings',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    caseId: uuid()
      .notNull()
      .references(() => cases.id),
    revisionId: uuid()
      .notNull()
      .references(() => caseRevisions.id),
    batchId: uuid().notNull(),
    pricePaid: bigint({ mode: 'number' }).notNull(),
    isFree: boolean().notNull().default(false),
    source: text().notNull().default('direct'),
    fairSeedId: uuid()
      .notNull()
      .references(() => fairSeeds.id),
    nonce: integer().notNull(),
    ticket: integer().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    itemValue: bigint({ mode: 'number' }).notNull(),
    userItemId: uuid().references(() => userItems.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('case_openings_user_idx').on(t.userId, t.createdAt),
    index('case_openings_case_idx').on(t.caseId, t.createdAt),
    index('case_openings_created_idx').on(t.createdAt),
    index('case_openings_seed_idx').on(t.fairSeedId),
  ],
);

/** Таймеры пользователя: free_case:<id>, wheel, daily. */
export const userCooldowns = pgTable(
  'user_cooldowns',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    availableAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const banners = pgTable('banners', {
  id: uuid().primaryKey(),
  gameId: smallint().references(() => games.id),
  imageUrl: text(),
  title: jsonb().$type<LocalizedText>().notNull(),
  subtitle: jsonb().$type<LocalizedText>(),
  link: text(),
  accentColor: text().notNull().default('#C6FF00'),
  sortOrder: integer().notNull().default(0),
  startsAt: timestamp({ withTimezone: true }),
  endsAt: timestamp({ withTimezone: true }),
  isActive: boolean().notNull().default(true),
});

/** Outbox: доменные события пишутся в транзакции операции, воркер раздаёт их обработчикам. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('outbox_pending_idx')
      .on(t.availableAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);
