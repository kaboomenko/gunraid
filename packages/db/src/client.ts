import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

// int8 → number (суммы в гемах помещаются в Number.MAX_SAFE_INTEGER; иначе — ошибка, а не тихая потеря).
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 out of safe range: ${value}`);
  return n;
});

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

export interface CreateDbOptions {
  max?: number;
  /** Сколько ждать свободное соединение пула, мс (0 — бесконечно). */
  acquireTimeoutMs?: number;
  /**
   * PostgreSQL сам закрывает сессию, «зависшую» внутри транзакции дольше этого времени (мс):
   * блокировки строк не держатся вечно, если процесс потерял транзакцию.
   */
  idleInTransactionTimeoutMs?: number;
  applicationName?: string;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.acquireTimeoutMs ?? 0,
    ...(options.idleInTransactionTimeoutMs
      ? { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs }
      : {}),
    ...(options.applicationName ? { application_name: options.applicationName } : {}),
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
