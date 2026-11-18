import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { rkey } from '../../core/redis.js';
import { ENV, REDIS } from '../../core/tokens.js';

const STALE_MS = 20_000;

/** Онлайн = сумма соединений всех инстансов API (каждый пишет свой счётчик с отметкой времени). */
@Injectable()
export class OnlineService {
  readonly instanceId = randomBytes(6).toString('hex');
  private local = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  inc(): void {
    this.local += 1;
  }

  dec(): void {
    this.local = Math.max(0, this.local - 1);
  }

  get localCount(): number {
    return this.local;
  }

  async publish(): Promise<void> {
    await this.redis.hset(rkey(this.env, 'online'), this.instanceId, `${this.local}:${Date.now()}`);
  }

  async total(): Promise<number> {
    const all = await this.redis.hgetall(rkey(this.env, 'online'));
    const now = Date.now();
    let sum = 0;
    const stale: string[] = [];
    for (const [id, value] of Object.entries(all)) {
      const [countRaw, tsRaw] = value.split(':');
      const ts = Number(tsRaw);
      if (!Number.isFinite(ts) || now - ts > STALE_MS) {
        stale.push(id);
        continue;
      }
      sum += Number(countRaw) || 0;
    }
    if (stale.length) await this.redis.hdel(rkey(this.env, 'online'), ...stale);
    return sum;
  }

  async remove(): Promise<void> {
    await this.redis.hdel(rkey(this.env, 'online'), this.instanceId);
  }
}
