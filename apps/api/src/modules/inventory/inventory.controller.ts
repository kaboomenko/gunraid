import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  gameCodeSchema,
  inventoryQuerySchema,
  sellSchema,
  type InventoryQuery,
  type SellBody,
  type SellResultDto,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { InventoryService } from './inventory.service.js';

@Controller('games/:game/inventory')
@Auth()
export class InventoryController {
  constructor(
    private readonly games: GamesService,
    private readonly inventory: InventoryService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  @Get()
  async list(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(inventoryQuerySchema) query: InventoryQuery,
    @CurrentUser() user: AuthContext,
  ) {
    return this.inventory.list(user.userId, (await this.games.getActive(game)).id, query);
  }

  @Post('sell')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async sell(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(sellSchema) body: SellBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<SellResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result, replayed } = await this.idempotency.run(
      user.userId,
      key,
      `sell:${g.code}`,
      body,
      (tx) => this.inventory.sell(tx, user.userId, g.id, body),
    );
    if (!replayed) this.realtime.balance(user.userId, result.balance);
    return result;
  }
}
