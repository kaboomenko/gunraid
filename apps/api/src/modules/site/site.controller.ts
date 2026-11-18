import { Controller, Get, Inject } from '@nestjs/common';
import { caseOpenings, users, type Db } from '@gunraid/db';
import type { PublicConfigDto, SiteStatsDto } from '@gunraid/shared';
import { count, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  isDevLoginEnabled,
  isGoogleEnabled,
  isTelegramEnabled,
  type Env,
} from '../../config/env.js';
import { rkey } from '../../core/redis.js';
import { DB, ENV, REDIS } from '../../core/tokens.js';
import { GamesService } from '../games/games.service.js';
import { OnlineService } from '../realtime/online.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Controller()
export class SiteController {
  private usersCache: { value: number; expires: number } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly games: GamesService,
    private readonly online: OnlineService,
  ) {}

  @Get('health')
  async health() {
    await this.db.execute(sql`select 1`);
    await this.redis.ping();
    return { ok: true, version: this.env.APP_VERSION };
  }

  @Get('config')
  async config(): Promise<PublicConfigDto> {
    const [currency, site] = await Promise.all([
      this.settings.get('currency'),
      this.settings.get('site'),
    ]);
    const games = (await this.games.listActive()).map((g) => this.games.toDto(g));
    return {
      gemsPerUsd: currency.gemsPerUsd,
      defaultGame: games.some((g) => g.code === site.defaultGame)
        ? site.defaultGame
        : (games[0]?.code ?? site.defaultGame),
      games,
      supportTelegramUrl: site.supportTelegramUrl,
      auth: {
        steam: true,
        google: isGoogleEnabled(this.env),
        telegram: isTelegramEnabled(this.env)
          ? { botUsername: this.env.TELEGRAM_BOT_USERNAME as string }
          : null,
        dev: isDevLoginEnabled(this.env),
      },
    };
  }

  @Get('stats')
  async stats(): Promise<SiteStatsDto> {
    return {
      online: await this.online.total(),
      users: await this.usersTotal(),
      casesOpened: await this.casesOpened(),
    };
  }

  private async casesOpened(): Promise<number> {
    const key = rkey(this.env, 'stats', 'cases_opened');
    const cached = await this.redis.get(key);
    if (cached !== null) return Number(cached) || 0;
    const [row] = await this.db.select({ value: count() }).from(caseOpenings);
    const value = row?.value ?? 0;
    await this.redis.set(key, String(value), 'NX');
    return value;
  }

  private async usersTotal(): Promise<number> {
    if (this.usersCache && this.usersCache.expires > Date.now()) return this.usersCache.value;
    const [row] = await this.db.select({ value: count() }).from(users);
    const value = row?.value ?? 0;
    this.usersCache = { value, expires: Date.now() + 30_000 };
    return value;
  }
}
