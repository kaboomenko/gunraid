import { Inject, Injectable, Logger } from '@nestjs/common';
import { settings, type Db, type DbOrTx } from '@gunraid/db';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMAS,
  type SettingsKey,
  type SettingsValue,
} from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';

const CACHE_TTL_MS = 5_000;

/** Типизированные настройки из таблицы settings с коротким кэшем (изменения из админки видны за ≤5 с). */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { value: unknown; expires: number }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async get<K extends SettingsKey>(key: K, scope = 'global'): Promise<SettingsValue<K>> {
    const cacheKey = `${key}:${scope}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value as SettingsValue<K>;

    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, key), eq(settings.scope, scope)))
      .limit(1);
    let value: SettingsValue<K>;
    const raw = rows[0]?.value;
    const parsed = raw === undefined ? null : SETTINGS_SCHEMAS[key].safeParse(raw);
    if (parsed?.success) {
      value = parsed.data as SettingsValue<K>;
    } else {
      if (parsed && !parsed.success) {
        this.logger.warn(`settings "${key}" is invalid in DB, using defaults`);
      }
      value = DEFAULT_SETTINGS[key];
    }
    this.cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async set<K extends SettingsKey>(
    key: K,
    value: unknown,
    actorId: string | null,
    tx: DbOrTx = this.db,
    scope = 'global',
  ): Promise<SettingsValue<K>> {
    const parsed = SETTINGS_SCHEMAS[key].parse(value) as SettingsValue<K>;
    await tx
      .insert(settings)
      .values({ key, scope, value: parsed, updatedBy: actorId })
      .onConflictDoUpdate({
        target: [settings.key, settings.scope],
        set: { value: parsed, updatedBy: actorId, updatedAt: sql`now()` },
      });
    this.cache.delete(`${key}:${scope}`);
    return parsed;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
