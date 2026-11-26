import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  cargoBuySchema,
  gameCodeSchema,
  type CargoBuyBody,
  type CargoBuyResultDto,
  type CargoDetailDto,
  type CargoListDto,
  type CargoProofDto,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
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
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService } from './cargo.service.js';

@Controller('games/:game/cargo')
export class CargoController {
  constructor(
    private readonly games: GamesService,
    private readonly cargo: CargoService,
    private readonly notifier: CargoNotifier,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Грузы игры с открытым раундом (по порядку шаблонов). */
  @Get()
  async list(@ZParam('game', gameCodeSchema) game: string): Promise<CargoListDto> {
    return this.cargo.list(await this.games.getActive(game));
  }

  @Get(':slug')
  @OptionalAuth()
  async detail(
    @ZParam('game', gameCodeSchema) game: string,
    @Param('slug') slug: string,
    @CurrentUser() user: AuthContext | null,
  ): Promise<CargoDetailDto> {
    return this.cargo.detail(
      await this.games.getActive(game),
      slug,
      user ? { userId: user.userId, adultConfirmed: user.adultConfirmed } : null,
    );
  }

  /** Покупка мест: те же проверки, что у открытия кейса (вход, 18+, бан, лимит запросов, идемпотентность). */
  @Post(':slug/buy')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async buy(
    @ZParam('game', gameCodeSchema) game: string,
    @Param('slug') slug: string,
    @ZBody(cargoBuySchema) body: CargoBuyBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<CargoBuyResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game); // до транзакции: кэш игр может пойти в this.db
    const { result, replayed } = await this.idempotency.run(
      user.userId,
      key,
      `cargo:${g.code}:${slug}`,
      body,
      (tx) => this.cargo.buy(tx, user.userId, g, slug, body),
    );
    // События — только после коммита и только для нового ответа (повтор ключа — без событий).
    if (!replayed) await this.notifier.purchased(user.userId, g.code, result);
    return result;
  }
}

@Controller('fair/proof')
export class CargoProofController {
  constructor(private readonly cargo: CargoService) {}

  /** Данные для проверки раунда груза; `purchases[].mine` — покупки того, кто смотрит. */
  @Get('cargo/:id')
  @OptionalAuth()
  @RateLimit('general')
  proof(
    @ZParam('id', z.string().uuid()) id: string,
    @CurrentUser() user: AuthContext | null,
  ): Promise<CargoProofDto> {
    return this.cargo.proof(id, user?.userId ?? null);
  }
}
