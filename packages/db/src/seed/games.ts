import type { GameFeatures } from '@gunraid/shared';
import type { Db } from '../client.js';
import { games } from '../schema/index.js';

export const SEED_GAME_ROWS: Array<{
  code: string;
  name: string;
  shortName: string;
  sortOrder: number;
  features: GameFeatures;
}> = [
  {
    code: 'standoff2',
    name: 'Standoff 2',
    shortName: 'SO2',
    sortOrder: 1,
    features: { wear: false, stattrak: true, withdrawTarget: 'player_id', requiresSteam: false },
  },
  {
    code: 'cs2',
    name: 'Counter-Strike 2',
    shortName: 'CS2',
    sortOrder: 2,
    features: { wear: true, stattrak: true, withdrawTarget: 'trade_url', requiresSteam: true },
  },
];

export async function seedGames(db: Db): Promise<void> {
  await db.insert(games).values(SEED_GAME_ROWS).onConflictDoNothing({ target: games.code });
}
