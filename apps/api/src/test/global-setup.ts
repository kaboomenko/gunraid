import { createDb, runMigrations, seedAll } from '@gunraid/db';
import { Redis } from 'ioredis';
import pg from 'pg';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env.js';

/** Создаёт тестовую БД (если нет), применяет миграции и сиды, чистит тестовые ключи Redis. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
  if (!exists.rowCount) await client.query(`create database "${dbName}"`);
  await client.end();

  await runMigrations(TEST_DATABASE_URL);
  const { db, pool } = createDb(TEST_DATABASE_URL, { max: 2 });
  try {
    await seedAll(db, { demo: true });
  } finally {
    await pool.end();
  }

  const redis = new Redis(TEST_REDIS_URL);
  const keys = await redis.keys('test:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
}
