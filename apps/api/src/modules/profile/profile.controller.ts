import { Controller, Get, Param, Query } from '@nestjs/common';
import { gameCodeSchema } from '@gunraid/shared';
import { z } from 'zod';
import { Auth, CurrentUser, type AuthContext } from '../../common/auth.decorators.js';
import { ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { ProfileService } from './profile.service.js';

const gameQuery = z.object({ game: gameCodeSchema, cursor: z.string().max(64).optional() });

@Controller('me')
@Auth()
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly games: GamesService,
  ) {}

  @Get('stats')
  async stats(@CurrentUser() user: AuthContext, @ZQuery(gameQuery) q: z.infer<typeof gameQuery>) {
    return this.profile.stats(user.userId, (await this.games.getActive(q.game)).id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthContext, @Query('cursor') cursor?: string) {
    const c = cursor ? z.coerce.number().int().positive().parse(cursor) : undefined;
    return this.profile.transactions(user.userId, c);
  }

  @Get('history/drops')
  async drops(@CurrentUser() user: AuthContext, @ZQuery(gameQuery) q: z.infer<typeof gameQuery>) {
    const cursor = q.cursor ? z.string().datetime().parse(q.cursor) : undefined;
    return this.profile.drops(user.userId, (await this.games.getActive(q.game)).id, cursor);
  }
}

@Controller('users')
export class PublicProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly games: GamesService,
  ) {}

  @Get(':shortId/stats')
  async stats(@Param('shortId') shortIdRaw: string, @ZQuery(z.object({ game: gameCodeSchema })) q: { game: string }) {
    const shortId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(shortIdRaw);
    return this.profile.publicStats(shortId, (await this.games.getActive(q.game)).id);
  }
}
