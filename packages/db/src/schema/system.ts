import { bigint, index, inet, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Настройки режимов и бонусов: key + scope ('global' или код игры). Схемы — в @gunraid/shared. */
export const settings = pgTable(
  'settings',
  {
    key: text().notNull(),
    scope: text().notNull().default('global'),
    value: jsonb().notNull(),
    updatedBy: uuid().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.scope] })],
);

/** Аудит всех действий админов и изменений баланса вне игровой логики. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_entity_idx').on(t.entityType, t.entityId),
    index('admin_audit_actor_idx').on(t.actorId, t.createdAt),
    index('admin_audit_created_idx').on(t.createdAt),
  ],
);
