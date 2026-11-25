import { Inject, Injectable } from '@nestjs/common';
import { WS_EVENTS, WS_ROOMS, type FeedDropDto } from '@gunraid/shared';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { rkey } from '../../core/redis.js';
import { ENV, REDIS } from '../../core/tokens.js';

/** Сколько последних дропов хранить: лента на сайте крутит их по кругу, чем больше — тем реже повторы. */
const FEED_LENGTH = 60;

/** Лента live-дропов: последние дропы каждой игры в Redis + событие feed:drop в комнату игры. */
@Injectable()
export class FeedService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly realtime: RealtimeEmitter,
  ) {}

  private key(game: string): string {
    return rkey(this.env, 'feed', game);
  }

  async recent(game: string): Promise<FeedDropDto[]> {
    const raw = await this.redis.lrange(this.key(game), 0, FEED_LENGTH - 1);
    return raw.map((r) => JSON.parse(r) as FeedDropDto);
  }

  async publish(drop: FeedDropDto): Promise<void> {
    await this.redis
      .multi()
      .lpush(this.key(drop.game), JSON.stringify(drop))
      .ltrim(this.key(drop.game), 0, FEED_LENGTH - 1)
      .exec();
    this.realtime.toRoom(WS_ROOMS.feed(drop.game), WS_EVENTS.feedDrop, drop);
  }

  async incrementCasesOpened(count: number): Promise<void> {
    await this.redis.incrby(rkey(this.env, 'stats', 'cases_opened'), count);
  }
}
