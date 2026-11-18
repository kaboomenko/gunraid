import { z } from 'zod';

/** Код игры в URL и API. Список игр хранится в БД (таблица games), здесь — только формат. */
export const gameCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);
export type GameCode = string;

/** Известные на старте игры — для сидов и тестов. Код страниц не должен на них опираться. */
export const SEED_GAMES = {
  standoff2: 'standoff2',
  cs2: 'cs2',
} as const;

export type WithdrawTarget = 'trade_url' | 'player_id';

export interface GameFeatures {
  /** Износ FN/MW/FT/WW/BS и диапазон float (CS2). */
  wear: boolean;
  /** Флаги StatTrak / Souvenir. */
  stattrak: boolean;
  /** Куда выводится предмет: trade-ссылка Steam или игровой ID. */
  withdrawTarget: WithdrawTarget;
  /** Нужен ли привязанный Steam для вывода. */
  requiresSteam: boolean;
}

export const gameFeaturesSchema = z.object({
  wear: z.boolean(),
  stattrak: z.boolean(),
  withdrawTarget: z.enum(['trade_url', 'player_id']),
  requiresSteam: z.boolean(),
});

export interface GameDto {
  code: GameCode;
  name: string;
  shortName: string;
  sortOrder: number;
  features: GameFeatures;
}
