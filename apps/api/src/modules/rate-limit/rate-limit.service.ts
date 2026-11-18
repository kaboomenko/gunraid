import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import type { Env } from '../../config/env.js';
import { ENV, REDIS } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';

/** Корзины лимитов: points запросов за duration секунд. */
export const RATE_LIMIT_BUCKETS = {
  general: { points: 240, duration: 60 },
  auth: { points: 30, duration: 60 },
  game: { points: 12, duration: 3 },
  payment: { points: 15, duration: 60 },
  promo: { points: 6, duration: 60 },
  profile: { points: 30, duration: 60 },
  admin: { points: 300, duration: 60 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;

@Injectable()
export class RateLimitService {
  private readonly limiters = new Map<RateLimitBucket, RateLimiterRedis>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    for (const [name, cfg] of Object.entries(RATE_LIMIT_BUCKETS) as Array<
      [RateLimitBucket, { points: number; duration: number }]
    >) {
      this.limiters.set(
        name,
        new RateLimiterRedis({
          storeClient: redis,
          keyPrefix: `${env.REDIS_PREFIX}rl:${name}`,
          points: cfg.points,
          duration: cfg.duration,
        }),
      );
    }
  }

  async consume(bucket: RateLimitBucket, key: string, points = 1): Promise<void> {
    const limiter = this.limiters.get(bucket);
    if (!limiter) return;
    try {
      await limiter.consume(key, points);
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        throw new AppError('RATE_LIMITED', 429, { retryAfterMs: err.msBeforeNext, bucket });
      }
      throw err;
    }
  }
}
