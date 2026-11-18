import { DEFAULT_SETTINGS, SETTINGS_KEYS, SETTINGS_SCHEMAS, type AllSettings } from '@gunraid/shared';
import type { Db } from '../client.js';
import { settings } from '../schema/index.js';

export interface SettingsSeedOverrides {
  gemsPerUsd?: number;
  supportTelegramUrl?: string | null;
}

/** Вставляет значения по умолчанию; уже изменённые админом настройки не трогает. */
export async function seedSettings(db: Db, overrides: SettingsSeedOverrides = {}): Promise<void> {
  const values: AllSettings = structuredClone(DEFAULT_SETTINGS);
  if (overrides.gemsPerUsd) values.currency.gemsPerUsd = overrides.gemsPerUsd;
  if (overrides.supportTelegramUrl !== undefined) {
    values.site.supportTelegramUrl = overrides.supportTelegramUrl;
  }
  for (const key of SETTINGS_KEYS) {
    const parsed = SETTINGS_SCHEMAS[key].safeParse(values[key]);
    if (!parsed.success) {
      console.warn(`[seed] invalid override for settings "${key}", using defaults`);
      (values as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
    }
  }
  await db
    .insert(settings)
    .values(SETTINGS_KEYS.map((key) => ({ key, scope: 'global', value: values[key] })))
    .onConflictDoNothing();
}
