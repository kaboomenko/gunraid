import { z } from 'zod';
import { gameCodeSchema } from './games.js';

const share = z.number().min(0).max(1);
const gems = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * Типизированные настройки (таблица settings). Всё, что меняется из админки без правки кода.
 * Значения по умолчанию попадают в сиды и могут быть изменены админом.
 */
export const SETTINGS_SCHEMAS = {
  /** Курс внутренней валюты: сколько гемов стоит 1 доллар. */
  currency: z.object({
    gemsPerUsd: z.number().int().min(1).max(1_000_000),
    quoteTtlMinutes: z.number().int().min(1).max(60),
  }),
  site: z.object({
    defaultGame: gameCodeSchema,
    supportTelegramUrl: z.string().url().nullable(),
    /** Смещение «суток» сайта от UTC в минутах (ежедневный бонус, лидерборды). */
    dayUtcOffsetMinutes: z.number().int().min(-720).max(840),
  }),
  deposit: z.object({
    minGems: gems,
    maxGems: gems,
  }),
  sell: z.object({
    /** Доля текущей цены, которую получает пользователь при продаже предмета. */
    rate: z.number().min(0.1).max(1),
  }),
  upgrade: z.object({
    commission: z.number().min(0).max(0.9),
    maxChance: z.number().min(0.01).max(0.99),
    minChance: z.number().min(0.0001).max(0.5),
    multipliers: z.array(z.number().min(1.01).max(1000)).min(1).max(8),
  }),
  contract: z.object({
    commission: z.number().min(0).max(0.9),
    coefMin: z.number().min(0.01).max(10),
    coefMax: z.number().min(1).max(100),
    minItems: z.number().int().min(2).max(20),
    maxItems: z.number().int().min(2).max(20),
  }),
  battle: z.object({
    maxCases: z.number().int().min(1).max(100),
    lobbyTimeoutMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    roundDurationMs: z.number().int().min(1000).max(30_000),
    allowBots: z.boolean(),
  }),
  feed: z.object({
    minValueGems: gems,
    delayMs: z.number().int().min(0).max(30_000),
  }),
  firstDeposit: z.object({
    percent: share,
    maxBonusGems: gems,
  }),
  wheel: z.object({
    cooldownHours: z
      .number()
      .min(0)
      .max(24 * 30),
    minAccountAgeHours: z
      .number()
      .min(0)
      .max(24 * 365),
    requireDepositWithinDays: z.number().int().min(1).max(365).nullable(),
  }),
  daily: z.object({
    rewards: z.array(gems).min(1).max(31),
    requireDepositWithinDays: z.number().int().min(1).max(365).nullable(),
  }),
  referral: z.object({
    percent: z.number().min(0).max(0.5),
  }),
  xp: z.object({
    xpPerGem: z.number().min(0).max(100),
  }),
  antifraud: z.object({
    withdrawDelayAfterFirstDepositHours: z
      .number()
      .min(0)
      .max(24 * 30),
    newAccountDays: z.number().int().min(0).max(365),
    newAccountDailyWithdrawGems: gems,
    minDepositsForWithdrawGems: gems,
  }),
  withdrawal: z.object({
    so2ListingTimeoutMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    /** Сколько гемов стоит 1 золото Standoff 2; null — не задан, сумму сообщает оператор. */
    so2GemsPerGold: z.number().positive().nullable(),
    cs2TradeProtectionDays: z.number().int().min(0).max(30),
  }),
} as const;

export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];
export type SettingsValue<K extends SettingsKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;
export type AllSettings = { [K in SettingsKey]: SettingsValue<K> };

/** Стартовые значения (предложены на этапе 0, правятся в админке). */
export const DEFAULT_SETTINGS: AllSettings = {
  currency: { gemsPerUsd: 100, quoteTtlMinutes: 10 },
  site: { defaultGame: 'standoff2', supportTelegramUrl: null, dayUtcOffsetMinutes: 180 },
  deposit: { minGems: 100, maxGems: 1_000_000 },
  sell: { rate: 1 },
  upgrade: { commission: 0.1, maxChance: 0.75, minChance: 0.01, multipliers: [1.5, 2, 5, 10] },
  contract: { commission: 0.1, coefMin: 0.25, coefMax: 4, minItems: 3, maxItems: 10 },
  battle: { maxCases: 25, lobbyTimeoutMinutes: 30, roundDurationMs: 6000, allowBots: true },
  feed: { minValueGems: 0, delayMs: 6000 },
  firstDeposit: { percent: 0.1, maxBonusGems: 1000 },
  wheel: { cooldownHours: 24, minAccountAgeHours: 24, requireDepositWithinDays: 30 },
  daily: { rewards: [5, 10, 15, 20, 25, 30, 50], requireDepositWithinDays: null },
  referral: { percent: 0.05 },
  xp: { xpPerGem: 1 },
  antifraud: {
    withdrawDelayAfterFirstDepositHours: 24,
    newAccountDays: 7,
    newAccountDailyWithdrawGems: 5000,
    minDepositsForWithdrawGems: 100,
  },
  withdrawal: { so2ListingTimeoutMinutes: 30, so2GemsPerGold: null, cs2TradeProtectionDays: 7 },
};

export function parseSettings<K extends SettingsKey>(key: K, value: unknown): SettingsValue<K> {
  return SETTINGS_SCHEMAS[key].parse(value) as SettingsValue<K>;
}
