import { boolean, integer, jsonb, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import type { GameFeatures } from '@gunraid/shared';

export const games = pgTable('games', {
  id: smallint().primaryKey().generatedByDefaultAsIdentity(),
  code: text().notNull().unique(),
  name: text().notNull(),
  shortName: text().notNull(),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  features: jsonb().$type<GameFeatures>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
