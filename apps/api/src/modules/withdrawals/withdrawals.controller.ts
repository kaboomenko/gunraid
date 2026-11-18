import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Db } from '@gunraid/db';
import {
  adminWithdrawalApproveSchema,
  adminWithdrawalRejectSchema,
  adminWithdrawalSimulateSchema,
  adminWithdrawalsQuerySchema,
  COOKIES,
  gameCodeSchema,
  withdrawalCreateSchema,
  withdrawalListingSchema,
  type AdminPageDto,
  type AdminWithdrawalDto,
  type Cs2StubEvent,
  type WithdrawalCreateBody,
  type WithdrawalDto,
  type WithdrawalListingBody,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DB } from '../../core/tokens.js';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

const idSchema = z.string().uuid();
const gameQuery = z.object({ game: gameCodeSchema.optional() });

@Controller()
export class WithdrawalsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly games: GamesService,
    private readonly withdrawals: WithdrawalsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('games/:game/withdrawals/requirements')
  @Auth()
  async requirements(
    @ZParam('game', gameCodeSchema) game: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.withdrawals.requirements(user.userId, await this.games.getActive(game));
  }

  @Post('games/:game/withdrawals')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('payment')
  async create(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(withdrawalCreateSchema) body: WithdrawalCreateBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<WithdrawalDto> {
    const key = requireIdempotencyKey(req);
    const g = await this.games.getActive(game);
    const deviceId = (req.cookies?.[COOKIES.device] as string | undefined) ?? null;
    const { result } = await this.idempotency.run(
      user.userId,
      key,
      `withdraw:${g.code}`,
      body,
      async (tx) => ({
        id: await this.withdrawals.request(tx, user.userId, g, body.userItemId, {
          ip: req.ip ?? null,
          deviceId,
        }),
      }),
    );
    return this.withdrawals.getForUser(user.userId, result.id);
  }

  @Get('withdrawals')
  @Auth()
  async list(@ZQuery(gameQuery) q: z.infer<typeof gameQuery>, @CurrentUser() user: AuthContext) {
    const gameId = q.game ? (await this.games.getActive(q.game)).id : null;
    return this.withdrawals.listForUser(user.userId, gameId);
  }

  @Get('withdrawals/:id')
  @Auth()
  get(@ZParam('id', idSchema) id: string, @CurrentUser() user: AuthContext) {
    return this.withdrawals.getForUser(user.userId, id);
  }

  @Post('withdrawals/:id/listing')
  @HttpCode(200)
  @Auth()
  @RateLimit('payment')
  async listing(
    @ZParam('id', idSchema) id: string,
    @ZBody(withdrawalListingSchema) body: WithdrawalListingBody,
    @CurrentUser() user: AuthContext,
  ) {
    await this.withdrawals.submitListing(user.userId, id, body);
    return this.withdrawals.getForUser(user.userId, id);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  @Auth()
  @RateLimit('payment')
  async cancel(@ZParam('id', idSchema) id: string, @CurrentUser() user: AuthContext) {
    await this.withdrawals.cancel(user.userId, id);
    return this.withdrawals.getForUser(user.userId, id);
  }
}

/** Очередь выводов: support и admin. */
@Controller('admin/withdrawals')
@Auth({ roles: ['admin', 'support'] })
@RateLimit('admin')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  async list(
    @ZQuery(adminWithdrawalsQuerySchema) q: z.infer<typeof adminWithdrawalsQuerySchema>,
  ): Promise<AdminPageDto<AdminWithdrawalDto>> {
    const statuses = q.status ? q.status.split(',').filter(Boolean) : null;
    const { items, total } = await this.withdrawals.adminList(statuses, q.page, q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get(':id')
  get(@ZParam('id', idSchema) id: string) {
    return this.withdrawals.adminGet(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminWithdrawalApproveSchema) body: { priceGold?: number },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.withdrawals.approve(user.userId, id, body.priceGold, req.ip ?? null);
    return this.withdrawals.adminGet(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminWithdrawalRejectSchema) body: { reason: string },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.withdrawals.reject(user.userId, id, body.reason, req.ip ?? null);
    return this.withdrawals.adminGet(id);
  }

  @Post(':id/confirm-purchase')
  @HttpCode(200)
  async confirm(
    @ZParam('id', idSchema) id: string,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.withdrawals.confirmPurchase(user.userId, id, req.ip ?? null);
    return this.withdrawals.adminGet(id);
  }

  @Post(':id/simulate')
  @HttpCode(200)
  async simulate(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminWithdrawalSimulateSchema) body: { event: Cs2StubEvent },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.withdrawals.simulate(user.userId, id, body.event, req.ip ?? null);
    return this.withdrawals.adminGet(id);
  }
}
