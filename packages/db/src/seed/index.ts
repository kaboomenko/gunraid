import { pathToFileURL } from 'node:url';
import { createDb, type Db } from '../client.js';
import { seedBots } from './bots.js';
import {
  seedAchievements,
  seedLeaderboards,
  seedLevels,
  seedPromos,
  seedWheel,
} from './bonuses.js';
import { seedCargo } from './cargo.js';
import { seedCases } from './cases.js';
import { seedCatalog, seedFxRates } from './catalog.js';
import { seedDevUsers } from './dev-users.js';
import { seedGames } from './games.js';
import { seedSettings, type SettingsSeedOverrides } from './settings.js';

export interface SeedOptions extends SettingsSeedOverrides {
  /** Демо-данные (каталог, кейсы, бонусы) — для локального запуска и тестов. */
  demo?: boolean;
  /** Тестовые пользователи для dev-входа (никогда в production). */
  devUsers?: boolean;
}

/** Идемпотентные сиды: можно запускать при каждом старте. */
export async function seedAll(db: Db, options: SeedOptions = {}): Promise<void> {
  await seedGames(db);
  await seedSettings(db, options);
  await seedFxRates(db);
  await seedBots(db);
  await seedLevels(db);
  await seedAchievements(db);
  await seedLeaderboards(db);
  if (options.demo) await seedCatalog(db);
  if (options.demo) await seedCases(db);
  if (options.demo) await seedCargo(db);
  if (options.demo) await seedWheel(db);
  if (options.demo) await seedPromos(db);
  if (options.demo && options.devUsers) await seedDevUsers(db);
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const { db, pool } = createDb(url, { max: 2 });
  const supportUrl = process.env.SUPPORT_TELEGRAM_URL;
  seedAll(db, {
    demo: process.env.SEED_DEMO_DATA !== 'false',
    devUsers: process.env.APP_ENV !== 'production',
    gemsPerUsd: envNumber('GEMS_PER_USD'),
    supportTelegramUrl: supportUrl ? supportUrl : undefined,
  })
    .then(() => console.log('seed complete'))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
