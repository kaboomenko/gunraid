import type { UserItemDto } from './inventory.js';

export interface ProfileStatsDto {
  casesOpened: number;
  /** Сумма пополнений в гемах. */
  depositsTotal: number;
  bestDrop: UserItemDto | null;
  upgradesWon: number;
  contractsDone: number;
  battlesWon: number;
}

export interface PublicProfileStatsDto {
  bestDrop: UserItemDto | null;
  recentDrops: UserItemDto[];
}
