import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { settings, type Db, type DbOrTx } from '@gunraid/db';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  SETTINGS_SCHEMAS,
  type SettingsKey,
  type SettingsValue,
} from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';

/** Через сколько значение считается устаревшим (изменения из админки видны за ≤5 с + один запрос). */
const FRESH_MS = 5_000;

interface Entry {
  value: unknown;
  fetchedAt: number;
}

/**
 * Типизированные настройки из таблицы settings.
 *
 * Важно: get() вызывается и внутри транзакций, поэтому не должен ждать соединение пула —
 * иначе под нагрузкой все транзакции держат по соединению и ждут второе (пул исчерпан, всё встаёт).
 * Поэтому: все настройки загружаются при старте, дальше get() отдаёт значение из памяти сразу,
 * а устаревшее обновляет в фоне одним запросом (stale-while-revalidate).
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.preload();
    } catch (err) {
      // БД ещё недоступна — значения подтянутся при первом обращении.
      this.logger.warn(`settings preload failed: ${(err as Error).message}`);
    }
  }

  /** Все глобальные настройки одним запросом. */
  async preload(): Promise<void> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.scope, 'global'));
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const now = Date.now();
    for (const key of SETTINGS_KEYS) {
      this.cache.set(`${key}:global`, { value: this.parse(key, byKey.get(key)), fetchedAt: now });
    }
  }

  async get<K extends SettingsKey>(key: K, scope = 'global'): Promise<SettingsValue<K>> {
    const cacheKey = `${key}:${scope}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      if (Date.now() - hit.fetchedAt > FRESH_MS) {
        void this.load(key, scope).catch((err: unknown) =>
          this.logger.warn(`settings "${key}" refresh failed: ${(err as Error).message}`),
        );
      }
      return hit.value as SettingsValue<K>;
    }
    return this.load(key, scope);
  }

  /** Чтение из БД; параллельные обращения к одному ключу ждут один запрос. */
  private load<K extends SettingsKey>(key: K, scope: string): Promise<SettingsValue<K>> {
    const cacheKey = `${key}:${scope}`;
    const running = this.inflight.get(cacheKey);
    if (running) return running as Promise<SettingsValue<K>>;
    const task = (async () => {
      try {
        const rows = await this.db
          .select({ value: settings.value })
          .from(settings)
          .where(and(eq(settings.key, key), eq(settings.scope, scope)))
          .limit(1);
        const value = this.parse(key, rows[0]?.value);
        this.cache.set(cacheKey, { value, fetchedAt: Date.now() });
        return value;
      } finally {
        this.inflight.delete(cacheKey);
      }
    })();
    this.inflight.set(cacheKey, task);
    return task;
  }

  private parse<K extends SettingsKey>(key: K, raw: unknown): SettingsValue<K> {
    if (raw === undefined || raw === null) return DEFAULT_SETTINGS[key];
    const parsed = SETTINGS_SCHEMAS[key].safeParse(raw);
    if (parsed.success) return parsed.data as SettingsValue<K>;
    this.logger.warn(`settings "${key}" is invalid in DB, using defaults`);
    return DEFAULT_SETTINGS[key];
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
    // Значение сразу в кэше этого процесса; другие экземпляры увидят его после FRESH_MS.
    this.cache.set(`${key}:${scope}`, { value: parsed, fetchedAt: Date.now() });
    return parsed;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
