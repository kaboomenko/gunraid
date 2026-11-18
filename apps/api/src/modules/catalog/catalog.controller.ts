import { Controller, Get, Param } from '@nestjs/common';
import { gameCodeSchema, itemsQuerySchema, type ItemsQuery } from '@gunraid/shared';
import { ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { CatalogService } from './catalog.service.js';

@Controller('games/:game')
export class CatalogController {
  constructor(
    private readonly games: GamesService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('rarities')
  async rarities(@ZParam('game', gameCodeSchema) game: string) {
    return this.catalog.rarities((await this.games.getActive(game)).id);
  }

  @Get('items')
  async items(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(itemsQuerySchema) query: ItemsQuery,
  ) {
    return this.catalog.list((await this.games.getActive(game)).id, query);
  }

  @Get('items/facets')
  async facets(@ZParam('game', gameCodeSchema) game: string) {
    return this.catalog.facets((await this.games.getActive(game)).id);
  }

  @Get('items/:id')
  async item(@ZParam('game', gameCodeSchema) game: string, @Param('id') id: string) {
    return this.catalog.detail((await this.games.getActive(game)).id, id);
  }
}
