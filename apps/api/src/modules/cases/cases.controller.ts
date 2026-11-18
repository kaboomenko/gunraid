import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  WS_EVENTS,
  WS_ROOMS,
  gameCodeSchema,
  openCaseSchema,
  type CaseOpenResultDto,
  type OpenCaseBody,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { Auth, CurrentUser, OptionalAuth, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam } from '../../common/zod.js';
import { FeedService } from '../feed/feed.service.js';
import { GamesService } from '../games/games.service.js';
import { CasesService } from './cases.service.js';

@Controller('games/:game')
export class CasesController {
  constructor(
    private readonly games: GamesService,
    private readonly cases: CasesService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeEmitter,
    private readonly feed: FeedService,
  ) {}

  @Get('home')
  async home(@ZParam('game', gameCodeSchema) game: string) {
    return this.cases.home(await this.games.getActive(game));
  }

  @Get('feed')
  async recentFeed(@ZParam('game', gameCodeSchema) game: string) {
    return this.feed.recent((await this.games.getActive(game)).code);
  }

  @Get('cases/:slug')
  @OptionalAuth()
  async detail(
    @ZParam('game', gameCodeSchema) game: string,
    @Param('slug') slug: string,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.cases.detail(
      await this.games.getActive(game),
      slug,
      user ? { userId: user.userId, adultConfirmed: user.adultConfirmed } : null,
    );
  }

  @Post('cases/:slug/open')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async open(
    @ZParam('game', gameCodeSchema) game: string,
    @Param('slug') slug: string,
    @ZBody(openCaseSchema) body: OpenCaseBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<CaseOpenResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result, replayed } = await this.idempotency.run(user.userId, key, `case:${g.code}:${slug}`, body, (tx) =>
      this.cases.open(tx, user.userId, g, slug, body.count),
    );
    if (!replayed) {
      this.realtime.balance(user.userId, result.balance);
      if (result.supplyUsed !== null && result.caseId && result.supplyTotal !== null) {
        this.realtime.toRoom(WS_ROOMS.case(result.caseId), WS_EVENTS.caseSupply, {
          caseId: result.caseId,
          supplyUsed: result.supplyUsed,
          supplyTotal: result.supplyTotal,
        });
      }
    }
    return result;
  }
}
