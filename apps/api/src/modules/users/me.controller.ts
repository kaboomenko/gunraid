import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  AUTH_PROVIDERS,
  confirmAgeSchema,
  gameCodeSchema,
  gameProfileSchema,
  updateSettingsSchema,
  type GameProfileBody,
  type MeDto,
  type UpdateSettingsBody,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { getRequestMeta } from '../../common/http-context.js';
import { ZBody, ZParam } from '../../common/zod.js';
import { UsersService } from './users.service.js';

@Controller('me')
@Auth()
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthContext): Promise<MeDto> {
    return this.users.getMe(user.userId);
  }

  @Post('confirm-age')
  @HttpCode(200)
  async confirmAge(
    @CurrentUser() user: AuthContext,
    @ZBody(confirmAgeSchema) _body: { confirm: true },
    @Req() req: FastifyRequest,
  ): Promise<MeDto> {
    await this.users.confirmAge(user.userId, getRequestMeta(req).ip);
    return this.users.getMe(user.userId);
  }

  @Patch('settings')
  @RateLimit('profile')
  async settings(
    @CurrentUser() user: AuthContext,
    @ZBody(updateSettingsSchema) body: UpdateSettingsBody,
  ): Promise<MeDto> {
    await this.users.updateSettings(user.userId, body);
    return this.users.getMe(user.userId);
  }

  @Put('games/:game/profile')
  @RateLimit('profile')
  async gameProfile(
    @CurrentUser() user: AuthContext,
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(gameProfileSchema) body: GameProfileBody,
  ): Promise<MeDto> {
    await this.users.setGameProfile(user.userId, game, body);
    return this.users.getMe(user.userId);
  }

  @Delete('identities/:provider')
  @RateLimit('profile')
  async unlink(
    @CurrentUser() user: AuthContext,
    @ZParam('provider', z.enum(AUTH_PROVIDERS)) provider: (typeof AUTH_PROVIDERS)[number],
  ): Promise<MeDto> {
    await this.users.unlinkIdentity(user.userId, provider);
    return this.users.getMe(user.userId);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':shortId')
  profile(@Param('shortId') shortIdRaw: string) {
    const shortId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(shortIdRaw);
    return this.users.getPublicProfile(shortId);
  }
}
