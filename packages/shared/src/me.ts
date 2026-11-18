import { z } from 'zod';
import type { AuthProvider, Role } from './auth.js';
import { gameCodeSchema, type GameCode } from './games.js';

export const nicknameSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}_\-. ]+$/u);

export interface IdentityDto {
  provider: AuthProvider;
  displayName: string;
  linkedAt: string;
}

export interface GameProfileDto {
  tradeUrl: string | null;
  playerId: string | null;
}

export interface UserSettingsDto {
  soundEnabled: boolean;
  fastModeDefault: boolean;
}

export interface MeDto {
  id: string;
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  level: number;
  xp: number;
  /** Баланс в гемах (целое число). */
  balance: number;
  adultConfirmed: boolean;
  selectedGame: GameCode | null;
  settings: UserSettingsDto;
  identities: IdentityDto[];
  gameProfiles: Record<GameCode, GameProfileDto>;
  referralCode: string;
  createdAt: string;
}

export const updateSettingsSchema = z
  .object({
    soundEnabled: z.boolean().optional(),
    fastModeDefault: z.boolean().optional(),
    selectedGame: gameCodeSchema.optional(),
    nickname: nicknameSchema.optional(),
  })
  .strict();
export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;

export const confirmAgeSchema = z.object({ confirm: z.literal(true) }).strict();

export const gameProfileSchema = z
  .object({
    tradeUrl: z.string().trim().max(256).nullable().optional(),
    playerId: z.string().trim().max(32).nullable().optional(),
  })
  .strict();
export type GameProfileBody = z.infer<typeof gameProfileSchema>;

/** Формат trade-ссылки Steam. */
export const CS2_TRADE_URL_RE =
  /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=(\d{1,10})&token=([A-Za-z0-9_-]{8})$/;

/** Игровой ID Standoff 2 — только цифры. */
export const SO2_PLAYER_ID_RE = /^\d{4,15}$/;

/** steamID64 = accountId + 76561197960265728. */
export const STEAM64_BASE = 76561197960265728n;

export function parseTradeUrl(url: string): { partner: string; token: string } | null {
  const m = CS2_TRADE_URL_RE.exec(url.trim());
  if (!m || !m[1] || !m[2]) return null;
  return { partner: m[1], token: m[2] };
}

export function steamIdToAccountId(steamId64: string): string {
  return (BigInt(steamId64) - STEAM64_BASE).toString();
}

export interface PublicUserDto {
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
  level: number;
  createdAt: string;
}
