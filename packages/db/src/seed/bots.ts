import type { Db } from '../client.js';
import { botProfiles } from '../schema/index.js';

/** Боты для заполнения свободных мест в баттлах (кнопкой создателя). Не демо-данные — нужны и в продакшне. */
export const SEED_BOTS = [
  'Viper',
  'Ghost',
  'Hammer',
  'Nova',
  'Blitz',
  'Rook',
  'Saber',
  'Tundra',
  'Raven',
  'Comet',
  'Jolt',
  'Onyx',
].map((nickname, i) => ({ id: i + 1, nickname, avatarUrl: null }));

export async function seedBots(db: Db): Promise<void> {
  await db.insert(botProfiles).values(SEED_BOTS).onConflictDoNothing({ target: botProfiles.id });
}
