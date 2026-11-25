import type { GameCode, GameDto } from './games.js';

export interface PublicAuthConfig {
  steam: boolean;
  google: boolean;
  /** botId — числовой id бота (начало токена, не секрет): нужен окну входа Telegram. */
  telegram: { botUsername: string; botId: number } | null;
  dev: boolean;
}

/** Публичная конфигурация сайта (GET /config). */
export interface PublicConfigDto {
  gemsPerUsd: number;
  defaultGame: GameCode;
  games: GameDto[];
  supportTelegramUrl: string | null;
  auth: PublicAuthConfig;
  /** Промо-полоса над лентой дропов; null — выключена в админке. */
  promoStrip: { code: string; bonusPercent: number } | null;
  /** Бонус к первому пополнению, % (0 — выключен) — для баннера на главной. */
  firstDepositPercent: number;
}

export interface SiteStatsDto {
  online: number;
  users: number;
  casesOpened: number;
}
