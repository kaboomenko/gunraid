import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  inet,
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
import { cases, fairSeeds } from './cases.js';
import { items, type LocalizedText } from './catalog.js';
import { games } from './games.js';
import { users } from './users.js';

export const entitlementTypeEnum = pgEnum('entitlement_type', [
  'free_case',
  'wheel_spin',
  'deposit_bonus',
]);
export const entitlementStatusEnum = pgEnum('entitlement_status', ['active', 'used', 'expired']);
export const bonusSourceEnum = pgEnum('bonus_source', [
  'wheel',
  'promo',
  'level',
  'leaderboard',
  'achievement',
  'admin',
]);

/** Выданные «права»: бесплатное открытие кейса, дополнительное вращение колеса, бонус к пополнению. */
export const userEntitlements = pgTable(
  'user_entitlements',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: entitlementTypeEnum().notNull(),
    caseId: uuid().references(() => cases.id),
    /** Доля бонуса к пополнению (0.1 = 10 %). */
    percent: numeric({ precision: 6, scale: 4, mode: 'number' }),
    /** Потолок бонуса к пополнению в гемах. */
    maxAmount: bigint({ mode: 'number' }),
    sourceType: bonusSourceEnum().notNull(),
    sourceId: text(),
    status: entitlementStatusEnum().notNull().default('active'),
    expiresAt: timestamp({ withTimezone: true }),
    usedAt: timestamp({ withTimezone: true }),
    usedRefId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_entitlements_user_idx').on(t.userId, t.status, t.type)],
);

export const wheelPrizeTypeEnum = pgEnum('wheel_prize_type', [
  'balance',
  'item',
  'free_case',
  'deposit_bonus',
  'extra_spin',
]);

/** Призы колеса фортуны (набор на игру, вес задаётся в админке). */
export const wheelPrizes = pgTable(
  'wheel_prizes',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    type: wheelPrizeTypeEnum().notNull(),
    amount: bigint({ mode: 'number' }),
    itemId: uuid().references(() => items.id),
    caseId: uuid().references(() => cases.id),
    percent: numeric({ precision: 6, scale: 4, mode: 'number' }),
    maxAmount: bigint({ mode: 'number' }),
    weight: integer().notNull(),
    label: jsonb().$type<LocalizedText>().notNull(),
    color: text().notNull().default('#24242E'),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    index('wheel_prizes_game_idx').on(t.gameId, t.sortOrder),
    check('wheel_prizes_weight_positive', sql`${t.weight} > 0`),
  ],
);

export interface WheelPrizeSnapshot {
  id: string;
  type: string;
  weight: number;
  label: string;
}

export const wheelSpins = pgTable(
  'wheel_spins',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    prizeId: uuid()
      .notNull()
      .references(() => wheelPrizes.id),
    /** Набор призов с весами на момент вращения — для проверки Provably Fair. */
    prizesSnapshot: jsonb().$type<WheelPrizeSnapshot[]>().notNull(),
    prizeIndex: smallint().notNull(),
    isExtra: boolean().notNull().default(false),
    fairSeedId: uuid()
      .notNull()
      .references(() => fairSeeds.id),
    nonce: integer().notNull(),
    roll: doublePrecision().notNull(),
    ticket: integer().notNull(),
    resultRefType: text(),
    resultRefId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wheel_spins_user_idx').on(t.userId, t.createdAt)],
);

/** Партнёры (блогеры) — к ним привязываются промокоды. */
export const partners = pgTable('partners', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  userId: uuid().references(() => users.id),
  contacts: text(),
  note: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const promoTypeEnum = pgEnum('promo_type', [
  'balance',
  'deposit_bonus',
  'free_case',
  'wheel_spin',
  'item',
]);

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid().primaryKey(),
    /** Хранится в верхнем регистре; сравнение без учёта регистра. */
    code: text().notNull(),
    type: promoTypeEnum().notNull(),
    amount: bigint({ mode: 'number' }),
    percent: numeric({ precision: 6, scale: 4, mode: 'number' }),
    maxAmount: bigint({ mode: 'number' }),
    caseId: uuid().references(() => cases.id),
    itemId: uuid().references(() => items.id),
    /** Привязка к игре (null — любая). */
    gameId: smallint().references(() => games.id),
    totalLimit: integer(),
    perUserLimit: integer().notNull().default(1),
    activationsCount: integer().notNull().default(0),
    startsAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    /** Условие: пополнения на сумму не меньше (гемы) за последние N дней. */
    minDepositGems: bigint({ mode: 'number' }),
    minDepositPeriodDays: integer(),
    /** «Только для новых»: аккаунт не старше N часов. */
    newUsersMaxAgeHours: integer(),
    partnerId: uuid().references(() => partners.id),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('promo_codes_code_uq').on(sql`upper(${t.code})`),
    index('promo_codes_partner_idx').on(t.partnerId),
    check(
      'promo_codes_limit',
      sql`${t.totalLimit} IS NULL OR ${t.activationsCount} <= ${t.totalLimit}`,
    ),
  ],
);

export const promoActivations = pgTable(
  'promo_activations',
  {
    id: uuid().primaryKey(),
    promoId: uuid()
      .notNull()
      .references(() => promoCodes.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    resultRefType: text(),
    resultRefId: text(),
    ip: inet(),
    deviceId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('promo_activations_promo_idx').on(t.promoId, t.createdAt),
    index('promo_activations_user_idx').on(t.userId, t.promoId),
  ],
);

/** Ежедневный бонус: одна запись на пользователя за «день сайта» (часовой пояс из настроек). */
export const dailyBonusClaims = pgTable(
  'daily_bonus_claims',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    day: date({ mode: 'string' }).notNull(),
    streak: integer().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    ledgerEntryId: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('daily_bonus_claims_user_day_uq').on(t.userId, t.day)],
);

export interface LevelReward {
  balance?: number;
  wheelSpins?: number;
  depositBonus?: { percent: number; maxAmount: number };
}

/** Уровни: порог XP и награда за достижение (правится в админке). */
export const levels = pgTable('levels', {
  level: integer().primaryKey(),
  xpRequired: bigint({ mode: 'number' }).notNull(),
  reward: jsonb().$type<LevelReward>(),
});

/** Начисления XP (идемпотентно по источнику). */
export const xpEvents = pgTable(
  'xp_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    amount: bigint({ mode: 'number' }).notNull(),
    sourceType: text().notNull(),
    sourceId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('xp_events_source_uq').on(t.userId, t.sourceType, t.sourceId)],
);

/** Выданные награды за уровни — каждая не больше одного раза. */
export const levelRewardsGranted = pgTable(
  'level_rewards_granted',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id),
    level: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.level] })],
);

export const referralRewards = pgTable(
  'referral_rewards',
  {
    id: uuid().primaryKey(),
    referrerId: uuid()
      .notNull()
      .references(() => users.id),
    referralId: uuid()
      .notNull()
      .references(() => users.id),
    depositId: uuid().notNull(),
    depositGems: bigint({ mode: 'number' }).notNull(),
    percent: numeric({ precision: 6, scale: 4, mode: 'number' }).notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    ledgerEntryId: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_rewards_deposit_uq').on(t.depositId),
    index('referral_rewards_referrer_idx').on(t.referrerId, t.createdAt),
  ],
);

export const leaderboardPeriodEnum = pgEnum('leaderboard_period', ['day', 'week']);
export const leaderboardPeriodStatusEnum = pgEnum('leaderboard_period_status', [
  'open',
  'finalized',
]);

export interface LeaderboardPrize {
  from: number;
  to: number;
  amount: number;
}

export const leaderboards = pgTable(
  'leaderboards',
  {
    id: uuid().primaryKey(),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    period: leaderboardPeriodEnum().notNull(),
    metric: text().notNull().default('drop_value'),
    prizes: jsonb().$type<LeaderboardPrize[]>().notNull(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex('leaderboards_game_period_uq').on(t.gameId, t.period)],
);

export interface LeaderboardStanding {
  place: number;
  userId: string;
  value: number;
}

export const leaderboardPeriods = pgTable(
  'leaderboard_periods',
  {
    id: uuid().primaryKey(),
    leaderboardId: uuid()
      .notNull()
      .references(() => leaderboards.id),
    periodStart: timestamp({ withTimezone: true }).notNull(),
    periodEnd: timestamp({ withTimezone: true }).notNull(),
    status: leaderboardPeriodStatusEnum().notNull().default('open'),
    standings: jsonb().$type<LeaderboardStanding[]>(),
    finalizedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('leaderboard_periods_uq').on(t.leaderboardId, t.periodStart)],
);

export const leaderboardPayouts = pgTable(
  'leaderboard_payouts',
  {
    periodId: uuid()
      .notNull()
      .references(() => leaderboardPeriods.id),
    place: smallint().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    amount: bigint({ mode: 'number' }).notNull(),
    ledgerEntryId: bigint({ mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.periodId, t.place] })],
);

export interface AchievementCondition {
  type:
    | 'cases_opened'
    | 'upgrades_won'
    | 'upgrade_win_below'
    | 'contracts_done'
    | 'battles_won'
    | 'best_drop'
    | 'level'
    | 'daily_streak'
    | 'deposits'
    | 'referrals';
  target: number;
  /** Для upgrade_win_below — максимальный шанс (0.1 = 10 %). */
  maxChance?: number;
}

export const achievements = pgTable('achievements', {
  id: uuid().primaryKey(),
  code: text().notNull().unique(),
  name: jsonb().$type<LocalizedText>().notNull(),
  description: jsonb().$type<LocalizedText>().notNull(),
  icon: text().notNull(),
  condition: jsonb().$type<AchievementCondition>().notNull(),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
});

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id),
    achievementId: uuid()
      .notNull()
      .references(() => achievements.id),
    progress: bigint({ mode: 'number' }).notNull().default(0),
    unlockedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

/** Уведомления (колокольчик). Текст — по i18n-ключу типа, параметры — в params. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    params: jsonb().$type<Record<string, string | number>>().notNull().default({}),
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);
