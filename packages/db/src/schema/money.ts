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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const LEDGER_TYPES = [
  'deposit',
  'deposit_bonus',
  'deposit_reversal',
  'case_open',
  'item_sell',
  'upgrade_stake',
  'battle_entry',
  'battle_refund',
  'wheel_prize',
  'promo_balance',
  'daily_bonus',
  'level_reward',
  'referral_reward',
  'leaderboard_prize',
  'admin_adjustment',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const ledgerTypeEnum = pgEnum('ledger_type', LEDGER_TYPES);
export const depositStatusEnum = pgEnum('deposit_status', [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'reversed',
]);

/**
 * Журнал движения гемов. Только INSERT (UPDATE/DELETE запрещены триггером).
 * Типа «вывод гемов» нет: гемы не выводятся, выводятся только предметы.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: ledgerTypeEnum().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    balanceAfter: bigint({ mode: 'number' }).notNull(),
    refType: text().notNull(),
    refId: text(),
    idempotencyKey: text().notNull().unique(),
    actorId: uuid().references(() => users.id),
    reason: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_user_idx').on(t.userId, t.id),
    index('ledger_ref_idx').on(t.refType, t.refId),
    index('ledger_type_created_idx').on(t.type, t.createdAt),
    check('ledger_amount_non_zero', sql`${t.amount} <> 0`),
    check('ledger_balance_non_negative', sql`${t.balanceAfter} >= 0`),
    check(
      'ledger_admin_reason',
      sql`${t.type} <> 'admin_adjustment' OR (${t.reason} IS NOT NULL AND length(trim(${t.reason})) > 0)`,
    ),
  ],
);

/** Идемпотентность запросов: ключ фиксируется в той же транзакции, что и операция. */
export const idempotencyRequests = pgTable(
  'idempotency_requests',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    endpoint: text().notNull(),
    requestHash: text().notNull(),
    status: text().notNull().default('processing'),
    response: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_created_idx').on(t.createdAt),
  ],
);

/** Пополнения. Реальная валюта живёт только здесь; пользователю — только гемы. */
export const deposits = pgTable(
  'deposits',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    provider: text().notNull(),
    providerPaymentId: text(),
    method: text().notNull(),
    payCurrency: text().notNull(),
    payAmount: numeric({ precision: 30, scale: 10 }).notNull(),
    usdRate: numeric({ precision: 30, scale: 12 }).notNull(),
    gemsPerUsd: integer().notNull(),
    gemsAmount: bigint({ mode: 'number' }).notNull(),
    bonusGems: bigint({ mode: 'number' }).notNull().default(0),
    bonusSource: text(),
    entitlementId: uuid(),
    promoCodeId: uuid(),
    quoteExpiresAt: timestamp({ withTimezone: true }).notNull(),
    status: depositStatusEnum().notNull().default('pending'),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('deposits_provider_payment_uq').on(t.provider, t.providerPaymentId),
    index('deposits_user_idx').on(t.userId, t.createdAt),
    index('deposits_status_idx').on(t.status, t.createdAt),
  ],
);

/** Входящие вебхуки платёжных провайдеров (идемпотентная обработка по event_id). */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid().primaryKey(),
    provider: text().notNull(),
    eventId: text().notNull(),
    payload: jsonb().notNull(),
    signatureOk: boolean().notNull(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_events_provider_event_uq').on(t.provider, t.eventId)],
);

/** Курсы валют оплаты к доллару (для котировок пополнения). */
export const fxRates = pgTable('fx_rates', {
  currency: text().primaryKey(),
  kind: text().notNull(),
  usdRate: numeric({ precision: 30, scale: 12 }).notNull(),
  source: text().notNull().default('manual'),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
