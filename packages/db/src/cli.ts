import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { seedAll } from './seed/index.js';

/**
 * CLI для контейнера migrate: `node packages/db/dist/cli.js migrate-and-seed`.
 * Команды: migrate | seed | migrate-and-seed.
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate-and-seed';
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  if (command === 'migrate' || command === 'migrate-and-seed') {
    await runMigrations(url);
    console.log('[db] migrations applied');
  }
  if (command === 'seed' || command === 'migrate-and-seed') {
    const { db, pool } = createDb(url, { max: 2 });
    try {
      const gemsPerUsd = Number(process.env.GEMS_PER_USD);
      const supportUrl = process.env.SUPPORT_TELEGRAM_URL;
      await seedAll(db, {
        demo: process.env.SEED_DEMO_DATA !== 'false',
        gemsPerUsd: Number.isSafeInteger(gemsPerUsd) && gemsPerUsd > 0 ? gemsPerUsd : undefined,
        supportTelegramUrl: supportUrl ? supportUrl : undefined,
      });
      console.log('[db] seed complete');
    } finally {
      await pool.end();
    }
  }
}

main().catch((err: unknown) => {
  console.error('[db] failed:', err);
  process.exit(1);
});
