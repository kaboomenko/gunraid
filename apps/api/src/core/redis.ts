import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

export function createRedis(env: Env, name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `gunraid:${name}`,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return client;
}

/** Префикс всех ключей приложения в Redis (тесты используют свой). */
export function rkey(env: Env, ...parts: Array<string | number>): string {
  return `${env.REDIS_PREFIX}${parts.join(':')}`;
}
