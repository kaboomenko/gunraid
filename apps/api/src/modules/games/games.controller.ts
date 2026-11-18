import { Controller, Get } from '@nestjs/common';
import type { GameDto } from '@gunraid/shared';
import { GamesService } from './games.service.js';

@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  async list(): Promise<GameDto[]> {
    return (await this.games.listActive()).map((g) => this.games.toDto(g));
  }
}
