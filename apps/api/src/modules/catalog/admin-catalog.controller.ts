import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { gameCodeSchema } from '@gunraid/shared';
import { z } from 'zod';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { ZBody, ZParam } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { CsvImportService } from './csv-import.service.js';
import { PricesService } from './prices.js';

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(5 * 1024 * 1024),
});

@Controller('admin/catalog')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminCatalogController {
  constructor(
    private readonly games: GamesService,
    private readonly importer: CsvImportService,
    private readonly prices: PricesService,
  ) {}

  @Post(':game/import')
  @HttpCode(200)
  async import(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(importSchema) body: z.infer<typeof importSchema>,
    @CurrentUser() user: AuthContext,
  ) {
    return this.importer.import(await this.games.getActive(game), body.fileName, body.csv, user.userId);
  }

  @Post(':game/refresh-prices')
  @HttpCode(200)
  async refresh(@Param('game') game: string) {
    return { changed: await this.prices.refresh(await this.games.getActive(game)) };
  }
}
