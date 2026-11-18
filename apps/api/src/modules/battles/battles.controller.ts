import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  battleBotsSchema,
  battleCreateSchema,
  battleJoinSchema,
  battleListQuerySchema,
  gameCodeSchema,
  type BattleBotsBody,
  type BattleCreateBody,
  type BattleDto,
  type BattleJoinBody,
  type BattleListQuery,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import type { Db } from '@gunraid/db';
import { DB } from '../../core/tokens.js';
import {
  Auth,
  CurrentUser,
  OptionalAuth,
  RateLimit,
  type AuthContext,
} from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { BattlesNotifier } from './battles.notifier.js';
import { BattlesService } from './battles.service.js';

const idSchema = z.string().uuid();

@Controller()
export class BattlesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly games: GamesService,
    private readonly battles: BattlesService,
    private readonly notifier: BattlesNotifier,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('games/:game/battles/config')
  config() {
    return this.battles.config();
  }

  @Get('games/:game/battles/cases')
  async cases(@ZParam('game', gameCodeSchema) game: string) {
    return this.battles.eligibleCases(await this.games.getActive(game));
  }

  @Get('games/:game/battles')
  @OptionalAuth()
  async list(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(battleListQuerySchema) q: BattleListQuery,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.battles.list(await this.games.getActive(game), q, user?.userId ?? null);
  }

  @Post('games/:game/battles')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async create(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(battleCreateSchema) body: BattleCreateBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<BattleDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result, replayed } = await this.idempotency.run(
      user.userId,
      key,
      `battle-create:${g.code}`,
      body,
      (tx) => this.battles.create(tx, user.userId, g, body),
    );
    if (!replayed) await this.notifier.changed(result);
    return this.battles.get(result.battleId);
  }

  @Get('battles/:id')
  async get(@ZParam('id', idSchema) id: string): Promise<BattleDto> {
    return this.battles.get(id);
  }

  @Post('battles/:id/join')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async join(
    @ZParam('id', idSchema) id: string,
    @ZBody(battleJoinSchema) body: BattleJoinBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<BattleDto> {
    const key = requireIdempotencyKey(req);
    const { result, replayed } = await this.idempotency.run(
      user.userId,
      key,
      `battle-join:${id}`,
      body,
      (tx) => this.battles.join(tx, user.userId, id, body),
    );
    if (!replayed) await this.notifier.changed(result);
    return this.battles.get(id);
  }

  @Post('battles/:id/bots')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async bots(
    @ZParam('id', idSchema) id: string,
    @ZBody(battleBotsSchema) body: BattleBotsBody,
    @CurrentUser() user: AuthContext,
  ): Promise<BattleDto> {
    const result = await this.db.transaction((tx) =>
      this.battles.addBots(tx, user.userId, id, body),
    );
    await this.notifier.changed(result);
    return this.battles.get(id);
  }

  @Post('battles/:id/cancel')
  @HttpCode(200)
  @Auth()
  @RateLimit('game')
  async cancel(
    @ZParam('id', idSchema) id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<BattleDto> {
    const result = await this.battles.cancel(id, 'creator', user.userId);
    await this.notifier.cancelled(result);
    return this.battles.get(id);
  }
}

@Controller('fair/proof')
export class BattlesProofController {
  constructor(private readonly battles: BattlesService) {}

  @Get('battle/:id')
  proof(@ZParam('id', idSchema) id: string) {
    return this.battles.proof(id);
  }
}
