import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { WS_EVENTS, WS_ROOMS } from '@gunraid/shared';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { createRedis } from './redis.js';
import { ENV } from './tokens.js';

/**
 * Отправка событий клиентам из любого процесса (API, воркер) через Redis.
 * Использует тот же ключ, что и Redis-адаптер Socket.IO.
 */
@Injectable()
export class RealtimeEmitter implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor(@Inject(ENV) env: Env) {
    this.redis = createRedis(env, 'emitter');
    this.emitter = new Emitter(this.redis, { key: `${env.REDIS_PREFIX}io` });
  }

  toRoom(room: string, event: string, payload: unknown): void {
    this.emitter.to(room).emit(event, payload);
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.toRoom(WS_ROOMS.user(userId), event, payload);
  }

  balance(userId: string, balance: number): void {
    this.toUser(userId, WS_EVENTS.balanceUpdate, { balance });
  }

  broadcast(event: string, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
