import { Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import {
  adminCargoCancelSchema,
  adminCargoListQuerySchema,
  adminCargoRoundsQuerySchema,
  adminCargoSchema,
  gameCodeSchema,
  type AdminCargoBody,
  type AdminCargoCancelBody,
  type AdminCargoDetailDto,
  type AdminCargoListQuery,
  type AdminCargoReconciliationDto,
  type AdminCargoRoundDetailDto,
  type AdminCargoRoundRowDto,
  type AdminCargoRoundsQuery,
  type AdminCargoRowDto,
  type AdminPageDto,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { AdminCargoService } from './admin-cargo.service.js';
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService } from './cargo.service.js';

/**
 * id шаблона и раунда из адреса — в нижнем регистре: z.string().uuid() пропускает прописные, а uuid в PostgreSQL
 * сравнивается без учёта регистра — без этого entity_id аудита и ref_id ledger (текст) зависели бы от написания.
 */
const idSchema = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
const ip = (req: FastifyRequest) => req.ip ?? null;

/**
 * Грузы в админке — только admin (support — 403): шаблоны с архивом (D37), текущий раунд и история, отмена раунда
 * с возвратом гемов (D33), сверка грузов с ledger (D39). События Socket.IO — после коммита.
 */
@Controller('admin')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminCargoController {
  constructor(
    private readonly games: GamesService,
    private readonly admin: AdminCargoService,
    private readonly cargo: CargoService,
    private readonly notifier: CargoNotifier,
  ) {}

  /** Шаблоны игры по порядку; `?archived=1` — вместе с архивными. */
  @Get('games/:game/cargo')
  async list(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(adminCargoListQuerySchema) q: AdminCargoListQuery,
  ): Promise<AdminCargoRowDto[]> {
    return this.admin.list(await this.games.getActive(game), q.archived === '1');
  }

  /** Новый груз; активный сразу получает раунд №1 (cargo:round). */
  @Post('games/:game/cargo')
  @HttpCode(200)
  async create(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(adminCargoSchema) body: AdminCargoBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<AdminCargoDetailDto> {
    const { id, opened } = await this.admin.create(
      user.userId,
      await this.games.getActive(game),
      body,
      ip(req),
    );
    if (opened) this.notifier.opened(opened);
    return this.admin.get(id);
  }

  @Get('cargo/:id')
  get(@ZParam('id', idSchema) id: string): Promise<AdminCargoDetailDto> {
    return this.admin.get(id);
  }

  /** Правка: идущий раунд живёт по своему снимку (D18); включённый груз без раунда получает его сразу. */
  @Put('games/:game/cargo/:id')
  async update(
    @ZParam('game', gameCodeSchema) game: string,
    @ZParam('id', idSchema) id: string,
    @ZBody(adminCargoSchema) body: AdminCargoBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<AdminCargoDetailDto> {
    const { opened } = await this.admin.update(
      user.userId,
      id,
      await this.games.getActive(game),
      body,
      ip(req),
    );
    if (opened) this.notifier.opened(opened);
    return this.admin.get(id);
  }

  /** «Удаление» — архив (D37): только без открытого раунда; повтор — 200 без изменений. */
  @Delete('cargo/:id')
  @HttpCode(200)
  async archive(
    @ZParam('id', idSchema) id: string,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<AdminCargoDetailDto> {
    await this.admin.archive(user.userId, id, ip(req));
    return this.admin.get(id);
  }

  @Get('cargo/:id/rounds')
  rounds(
    @ZParam('id', idSchema) id: string,
    @ZQuery(adminCargoRoundsQuerySchema) q: AdminCargoRoundsQuery,
  ): Promise<AdminPageDto<AdminCargoRoundRowDto>> {
    return this.admin.rounds(id, q);
  }

  // `cargo-rounds/…` и `cargo-reconciliation`, а не `cargo/rounds/…`: иначе сегмент разобрался бы как `cargo/:id`.

  @Get('cargo-rounds/:id')
  round(@ZParam('id', idSchema) id: string): Promise<AdminCargoRoundDetailDto> {
    return this.admin.round(id);
  }

  /**
   * Отмена открытого раунда с возвратом гемов (без idempotency key: повтор → 409 CARGO_ROUND_NOT_OPEN). После
   * коммита — балансы участникам, cargo:result со статусом cancelled и cargo:round следующего раунда.
   */
  @Post('cargo-rounds/:id/cancel')
  @HttpCode(200)
  async cancel(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminCargoCancelSchema) body: AdminCargoCancelBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<AdminCargoRoundDetailDto> {
    const res = await this.cargo.cancelRound(id, user.userId, body.reason, ip(req));
    this.notifier.finished(res);
    return this.admin.round(id);
  }

  @Get('cargo-reconciliation')
  reconciliation(): Promise<AdminCargoReconciliationDto> {
    return this.admin.reconciliation();
  }
}
