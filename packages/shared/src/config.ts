import type { GameCode, GameDto } from './games.js';

export interface PublicAuthConfig {
  steam: boolean;
  google: boolean;
  telegram: { botUsername: string } | null;
  dev: boolean;
}

/** Публичная конфигурация сайта (GET /config). */
export interface PublicConfigDto {
  gemsPerUsd: number;
  defaultGame: GameCode;
  games: GameDto[];
  supportTelegramUrl: string | null;
  auth: PublicAuthConfig;
}

export interface SiteStatsDto {
  online: number;
  users: number;
  casesOpened: number;
}
