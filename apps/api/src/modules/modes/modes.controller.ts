import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  contractSchema,
  gameCodeSchema,
  upgradeSchema,
  upgradeTargetsQuerySchema,
  type ContractBody,
  type ContractResultDto,
  type UpgradeBody,
  type UpgradeResultDto,
  type UpgradeTargetsQuery,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { ContractService } from './contract.service.js';
import { UpgradeService } from './upgrade.service.js';

@Controller('games/:game')
export class ModesController {
  constructor(
    private readonly games: GamesService,
    private readonly upgradeService: UpgradeService,
    private readonly contractService: ContractService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  @Get('upgrade/config')
  upgradeConfig() {
    return this.upgradeService.config();
  }

  @Get('upgrade/targets')
  async targets(@ZParam('game', gameCodeSchema) game: string, @ZQuery(upgradeTargetsQuerySchema) q: UpgradeTargetsQuery) {
    return this.upgradeService.targets(await this.games.getActive(game), q);
  }

  @Post('upgrade')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async upgrade(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(upgradeSchema) body: UpgradeBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<UpgradeResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result, replayed } = await this.idempotency.run(user.userId, key, `upgrade:${g.code}`, body, (tx) =>
      this.upgradeService.upgrade(tx, user.userId, g, body),
    );
    if (!replayed) this.realtime.balance(user.userId, result.balance);
    return result;
  }

  @Get('upgrade/history')
  @Auth()
  async upgradeHistory(@ZParam('game', gameCodeSchema) game: string, @CurrentUser() user: AuthContext) {
    return this.upgradeService.history(user.userId, await this.games.getActive(game));
  }

  @Get('contract/config')
  contractConfig() {
    return this.contractService.config();
  }

  @Post('contract')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('game')
  async contract(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(contractSchema) body: ContractBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<ContractResultDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const { result } = await this.idempotency.run(user.userId, key, `contract:${g.code}`, body, (tx) =>
      this.contractService.sign(tx, user.userId, g, body),
    );
    return result;
  }

  @Get('contract/history')
  @Auth()
  async contractHistory(@ZParam('game', gameCodeSchema) game: string, @CurrentUser() user: AuthContext) {
    return this.contractService.history(user.userId, await this.games.getActive(game));
  }
}

@Controller('fair/proof')
export class ModesProofController {
  constructor(
    private readonly upgradeService: UpgradeService,
    private readonly contractService: ContractService,
  ) {}

  @Get('upgrade/:id')
  upgrade(@Param('id') id: string) {
    return this.upgradeService.proof(z.string().uuid().parse(id));
  }

  @Get('contract/:id')
  contract(@Param('id') id: string) {
    return this.contractService.proof(z.string().uuid().parse(id));
  }
}
