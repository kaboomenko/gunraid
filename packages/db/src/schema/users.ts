import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accessEventEnum, authProviderEnum, userRoleEnum, userStatusEnum } from './enums.js';
import { games } from './games.js';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    shortId: bigint({ mode: 'number' })
      .notNull()
      .unique()
      .generatedAlwaysAsIdentity({ startWith: 100000 }),
    nickname: text().notNull(),
    avatarUrl: text(),
    role: userRoleEnum().notNull().default('user'),
    status: userStatusEnum().notNull().default('active'),
    banReason: text(),
    level: integer().notNull().default(1),
    xp: bigint({ mode: 'number' }).notNull().default(0),
    adultConfirmedAt: timestamp({ withTimezone: true }),
    adultConfirmedIp: inet(),
    selectedGameId: smallint().references(() => games.id),
    soundEnabled: boolean().notNull().default(true),
    fastModeDefault: boolean().notNull().default(false),
    referralCode: text().notNull().unique(),
    referredById: uuid().references((): AnyPgColumn => users.id),
    isSuspicious: boolean().notNull().default(false),
    suspiciousNote: text(),
    firstDepositAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('users_referred_by_idx').on(t.referredById), index('users_created_at_idx').on(t.createdAt)],
);

export interface IdentityProfile {
  displayName?: string;
  avatarUrl?: string | null;
  email?: string | null;
  username?: string | null;
}

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProviderEnum().notNull(),
    providerUserId: text().notNull(),
    profile: jsonb().$type<IdentityProfile>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_identities_provider_uid_uq').on(t.provider, t.providerUserId),
    uniqueIndex('auth_identities_user_provider_uq').on(t.userId, t.provider),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    refreshTokenHash: text().notNull().unique(),
    ip: inet(),
    userAgent: text(),
    deviceId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokeReason: text(),
    replacedById: uuid(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

export const userGameProfiles = pgTable(
  'user_game_profiles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: smallint()
      .notNull()
      .references(() => games.id),
    tradeUrl: text(),
    playerId: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId] })],
);

export const userAccessLog = pgTable(
  'user_access_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: accessEventEnum().notNull(),
    ip: inet(),
    deviceId: text(),
    fingerprintHash: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_access_log_user_idx').on(t.userId, t.createdAt),
    index('user_access_log_ip_idx').on(t.ip),
    index('user_access_log_device_idx').on(t.deviceId),
  ],
);

/** Баланс в гемах. Меняется только вместе с записью в ledger (этап 2). */
export const wallets = pgTable(
  'wallets',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: bigint({ mode: 'number' }).notNull().default(0),
    lastEntryId: bigint({ mode: 'number' }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('wallets_balance_non_negative', sql`${t.balance} >= 0`)],
);
