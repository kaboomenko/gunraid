import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDb, type DbHandle } from '@gunraid/db';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { GamesService } from '../modules/games/games.service.js';
import { RateLimitService } from '../modules/rate-limit/rate-limit.service.js';
import { SettingsService } from '../modules/settings/settings.service.js';
import { OutboxService } from '../modules/outbox/outbox.service.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { EntitlementsService } from '../modules/bonuses/entitlements.service.js';
import { RealtimeEmitter } from './realtime-emitter.js';
import { createRedis } from './redis.js';
import { DB, DB_POOL, ENV, REDIS } from './tokens.js';

const DB_HANDLE = Symbol('DB_HANDLE');

@Injectable()
class CoreLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DB_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
    await this.pool.end().catch(() => undefined);
  }
}

/** Глобальная инфраструктура: env, БД, Redis, настройки, игры, аудит, лимиты. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(
    env: Env,
    options: { dbPoolSize?: number; role?: 'api' | 'worker' } = {},
  ): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: ENV, useValue: env },
        {
          provide: DB_HANDLE,
          useFactory: (): DbHandle =>
            createDb(env.DATABASE_URL, {
              max: env.DB_POOL_SIZE ?? options.dbPoolSize ?? 20,
              acquireTimeoutMs: env.DB_POOL_ACQUIRE_TIMEOUT_MS,
              idleInTransactionTimeoutMs: env.DB_IDLE_IN_TX_TIMEOUT_MS,
              applicationName: `gunraid-${options.role ?? 'api'}`,
            }),
        },
        { provide: DB, useFactory: (h: DbHandle) => h.db, inject: [DB_HANDLE] },
        { provide: DB_POOL, useFactory: (h: DbHandle) => h.pool, inject: [DB_HANDLE] },
        { provide: REDIS, useFactory: () => createRedis(env, 'main') },
        CoreLifecycle,
        SettingsService,
        AuditService,
        RateLimitService,
        GamesService,
        RealtimeEmitter,
        OutboxService,
        NotificationsService,
        EntitlementsService,
      ],
      exports: [
        ENV,
        DB,
        DB_POOL,
        REDIS,
        SettingsService,
        AuditService,
        RateLimitService,
        GamesService,
        RealtimeEmitter,
        OutboxService,
        NotificationsService,
        EntitlementsService,
      ],
    };
  }
}
