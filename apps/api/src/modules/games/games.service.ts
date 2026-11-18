import { Inject, Injectable } from '@nestjs/common';
import { games, type Db } from '@gunraid/db';
import type { GameDto } from '@gunraid/shared';
import { asc } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';

export type GameRow = typeof games.$inferSelect;
const CACHE_TTL_MS = 30_000;

@Injectable()
export class GamesService {
  private cache: { rows: GameRow[]; expires: number } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  async listAll(): Promise<GameRow[]> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.rows;
    const rows = await this.db.select().from(games).orderBy(asc(games.sortOrder), asc(games.id));
    this.cache = { rows, expires: Date.now() + CACHE_TTL_MS };
    return rows;
  }

  async listActive(): Promise<GameRow[]> {
    return (await this.listAll()).filter((g) => g.isActive);
  }

  async findByCode(code: string): Promise<GameRow | null> {
    return (await this.listAll()).find((g) => g.code === code) ?? null;
  }

  async findById(id: number): Promise<GameRow | null> {
    return (await this.listAll()).find((g) => g.id === id) ?? null;
  }

  /** Активная игра по коду или ошибка GAME_NOT_FOUND. */
  async getActive(code: string): Promise<GameRow> {
    const game = await this.findByCode(code);
    if (!game || !game.isActive) throw new AppError('GAME_NOT_FOUND', 404);
    return game;
  }

  toDto(row: GameRow): GameDto {
    return {
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      sortOrder: row.sortOrder,
      features: row.features,
    };
  }

  invalidate(): void {
    this.cache = null;
  }
}
