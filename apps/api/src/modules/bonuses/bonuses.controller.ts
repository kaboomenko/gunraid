import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { users, type Db } from '@gunraid/db';
import {
  COOKIES,
  gameCodeSchema,
  notificationsReadSchema,
  promoActivateSchema,
  type DailyClaimResultDto,
  type NotificationsReadBody,
  type PromoActivateBody,
  type WheelSpinResultDto,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { DB } from '../../core/tokens.js';
import { notFound } from '../../common/app-error.js';
import {
  Auth,
  CurrentUser,
  OptionalAuth,
  RateLimit,
  type AuthContext,
} from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AchievementsService } from './achievements.service.js';
import { DailyService } from './daily.service.js';
import { EntitlementsService } from './entitlements.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LevelsService } from './levels.service.js';
import { PromoService } from './promo.service.js';
import { ReferralService } from './referral.service.js';
import { WheelService } from './wheel.service.js';

const idSchema = z.string().uuid();
const shortIdSchema = z.coerce.number().int().positive();

@Controller()
export class BonusesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly games: GamesService,
    private readonly wheel: WheelService,
    private readonly daily: DailyService,
    private readonly promo: PromoService,
    private readonly entitlements: EntitlementsService,
    private readonly levels: LevelsService,
    private readonly referral: ReferralService,
    private readonly leaderboards: LeaderboardService,
    private readonly achievements: AchievementsService,
    private readonly notifications: NotificationsService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  // ---------- Колесо ----------

  @Get('games/:game/wheel')
  @OptionalAuth()
  async wheelState(
    @ZParam('game', gameCodeSchema) game: string,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.wheel.state(
      await this.games.getActive(game),
      user ? { userId: user.userId, adultConfirmed: user.adultConfirmed } : null,
    );
  }

  @Post('games/:game/wheel/spin')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async spin(
    @ZParam('game', gameCodeSchema) game: string,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<WheelSpinResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result, replayed } = await this.idempotency.run(
      user.userId,
      key,
      `wheel:${g.code}`,
      {},
      (tx) => this.wheel.spin(tx, user.userId, g),
    );
    if (!replayed) this.realtime.balance(user.userId, result.balance);
    return result;
  }

  @Get('fair/proof/wheel_spin/:id')
  wheelProof(@ZParam('id', idSchema) id: string) {
    return this.wheel.proof(id);
  }

  // ---------- Ежедневный бонус ----------

  @Get('bonuses/daily')
  @Auth()
  dailyState(@CurrentUser() user: AuthContext) {
    return this.daily.state(user.userId);
  }

  @Post('bonuses/daily/claim')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async dailyClaim(
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DailyClaimResultDto> {
    const key = requireIdempotencyKey(req);
    const { result, replayed } = await this.idempotency.run(user.userId, key, 'daily', {}, (tx) =>
      this.daily.claim(tx, user.userId),
    );
    if (!replayed) this.realtime.balance(user.userId, result.balance);
    return result;
  }

  // ---------- Промокоды ----------

  @Post('promo/activate')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('promo')
  async activate(
    @ZBody(promoActivateSchema) body: PromoActivateBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const deviceId = (req.cookies?.[COOKIES.device] as string | undefined) ?? null;
    const result = await this.db.transaction((tx) =>
      this.promo.activate(tx, user.userId, body, { ip: req.ip ?? null, deviceId }),
    );
    if (result.balance !== null) this.realtime.balance(user.userId, result.balance);
    return result;
  }

  // ---------- Права, уровень, рефералы, ачивки ----------

  @Get('me/entitlements')
  @Auth()
  myEntitlements(@CurrentUser() user: AuthContext) {
    return this.entitlements.list(user.userId);
  }

  @Get('me/level')
  @Auth()
  myLevel(@CurrentUser() user: AuthContext) {
    return this.levels.info(user.userId);
  }

  @Get('levels')
  levelTable() {
    return this.levels.table();
  }

  @Get('me/referrals')
  @Auth()
  myReferrals(@CurrentUser() user: AuthContext) {
    return this.referral.info(user.userId);
  }

  @Get('me/achievements')
  @Auth()
  myAchievements(@CurrentUser() user: AuthContext) {
    return this.achievements.list(user.userId);
  }

  @Get('users/:shortId/achievements')
  async userAchievements(@ZParam('shortId', shortIdSchema) shortId: number) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.shortId, shortId));
    if (!user) throw notFound();
    return this.achievements.list(user.id, true);
  }

  // ---------- Лидерборды ----------

  @Get('games/:game/leaderboards')
  @OptionalAuth()
  async leaderboardsGet(
    @ZParam('game', gameCodeSchema) game: string,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.leaderboards.get(await this.games.getActive(game), user?.userId ?? null);
  }

  // ---------- Уведомления ----------

  @Get('notifications')
  @Auth()
  notificationsList(@CurrentUser() user: AuthContext) {
    return this.notifications.list(user.userId);
  }

  @Post('notifications/read')
  @HttpCode(200)
  @Auth()
  notificationsRead(
    @ZBody(notificationsReadSchema) body: NotificationsReadBody,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notifications.markRead(user.userId, body.ids);
  }
}
