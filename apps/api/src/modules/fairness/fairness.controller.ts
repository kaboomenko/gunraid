import { Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { clientSeedSchema } from '@gunraid/shared';
import { z } from 'zod';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { ZBody } from '../../common/zod.js';
import { CasesService } from '../cases/cases.service.js';
import { FairnessService } from './fairness.service.js';

@Controller('fair')
export class FairnessController {
  constructor(
    private readonly fairness: FairnessService,
    private readonly cases: CasesService,
  ) {}

  @Get('seed')
  @Auth()
  seed(@CurrentUser() user: AuthContext) {
    return this.fairness.current(user.userId);
  }

  /** Новый client seed — вместе со сменой пары (старый server seed раскрывается). */
  @Put('client-seed')
  @Auth()
  @RateLimit('profile')
  clientSeed(@CurrentUser() user: AuthContext, @ZBody(clientSeedSchema) body: { clientSeed: string }) {
    return this.fairness.rotate(user.userId, body.clientSeed);
  }

  @Post('rotate')
  @HttpCode(200)
  @Auth()
  @RateLimit('profile')
  rotate(@CurrentUser() user: AuthContext) {
    return this.fairness.rotate(user.userId);
  }

  @Get('seeds')
  @Auth()
  seeds(@CurrentUser() user: AuthContext, @Query('cursor') cursor?: string) {
    return this.fairness.revealed(user.userId, cursor ? z.string().datetime().parse(cursor) : undefined);
  }

  /** Данные для проверки результата. Server seed раскрывается только после смены пары. */
  @Get('proof/case_opening/:id')
  proof(@Param('id') id: string) {
    return this.cases.proof(z.string().uuid().parse(id));
  }
}
