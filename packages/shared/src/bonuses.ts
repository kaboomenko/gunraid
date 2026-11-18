import { z } from 'zod';
import type { ItemDto } from './catalog.js';
import type { FairRefDto } from './modes.js';

const uuid = z.string().uuid();

// ---------- Права (бесплатный кейс, доп. вращение, бонус к пополнению) ----------

export type EntitlementType = 'free_case' | 'wheel_spin' | 'deposit_bonus';
export type BonusSource = 'wheel' | 'promo' | 'level' | 'leaderboard' | 'achievement' | 'admin';

export interface EntitlementDto {
  id: string;
  type: EntitlementType;
  case: {
    id: string;
    slug: string;
    name: string;
    imageUrl: string | null;
    game: string;
    price: number;
  } | null;
  percent: number | null;
  maxAmount: number | null;
  source: BonusSource;
  expiresAt: string | null;
  createdAt: string;
}

// ---------- Колесо ----------

export type WheelPrizeType = 'balance' | 'item' | 'free_case' | 'deposit_bonus' | 'extra_spin';

export interface WheelPrizeDto {
  id: string;
  type: WheelPrizeType;
  label: string;
  color: string;
  amount: number | null;
  percent: number | null;
  maxAmount: number | null;
  item: ItemDto | null;
  caseName: string | null;
  caseImage: string | null;
}

export const WHEEL_BLOCK_REASONS = [
  'LOGIN',
  'ADULT',
  'COOLDOWN',
  'ACCOUNT_AGE',
  'NO_DEPOSIT',
] as const;
export type WheelBlockReason = (typeof WHEEL_BLOCK_REASONS)[number];

export interface WheelSpinDto {
  id: string;
  prize: WheelPrizeDto;
  isExtra: boolean;
  createdAt: string;
}

export interface WheelStateDto {
  prizes: WheelPrizeDto[];
  canSpin: boolean;
  reason: WheelBlockReason | null;
  /** Когда снова доступно бесплатное вращение. */
  nextAt: string | null;
  extraSpins: number;
  cooldownHours: number;
  minAccountAgeHours: number;
  requireDepositWithinDays: number | null;
  history: WheelSpinDto[];
}

export interface WheelSpinResultDto {
  id: string;
  prizeIndex: number;
  prize: WheelPrizeDto;
  isExtra: boolean;
  balance: number;
  nextAt: string | null;
  extraSpins: number;
  fair: FairRefDto;
}

export interface WheelProofDto {
  type: 'wheel_spin';
  id: string;
  revealed: boolean;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  ticket: number;
  prizeIndex: number;
  prizes: Array<{ id: string; label: string; weight: number }>;
  createdAt: string;
}

// ---------- Ежедневный бонус ----------

export interface DailyStateDto {
  canClaim: boolean;
  claimedToday: boolean;
  /** Стрик с учётом сегодняшнего дня (если забрать сейчас — этот день стрика). */
  streak: number;
  todayReward: number;
  rewards: number[];
  nextAt: string;
  blocked: 'NO_DEPOSIT' | null;
  requireDepositWithinDays: number | null;
}

export interface DailyClaimResultDto {
  amount: number;
  streak: number;
  balance: number;
  nextAt: string;
}

// ---------- Промокоды ----------

export const promoActivateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    game: z
      .string()
      .regex(/^[a-z0-9-]{2,32}$/)
      .optional(),
  })
  .strict();
export type PromoActivateBody = z.infer<typeof promoActivateSchema>;

export type PromoType = 'balance' | 'deposit_bonus' | 'free_case' | 'wheel_spin' | 'item';

export interface PromoActivateResultDto {
  code: string;
  type: PromoType;
  amount: number | null;
  percent: number | null;
  maxAmount: number | null;
  item: ItemDto | null;
  caseName: string | null;
  caseSlug: string | null;
  game: string | null;
  balance: number | null;
}

// ---------- Уровни ----------

export interface LevelRewardDto {
  balance?: number;
  wheelSpins?: number;
  depositBonus?: { percent: number; maxAmount: number };
}

export interface LevelRowDto {
  level: number;
  xpRequired: number;
  reward: LevelRewardDto | null;
}

export interface LevelInfoDto {
  level: number;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number | null;
  nextReward: LevelRewardDto | null;
  maxLevel: number;
  xpPerGem: number;
}

// ---------- Рефералы ----------

export interface ReferralInfoDto {
  code: string;
  percent: number;
  invited: number;
  depositors: number;
  earned: number;
  recent: Array<{ nickname: string; amount: number; createdAt: string }>;
}

// ---------- Лидерборды ----------

export type LeaderboardPeriod = 'day' | 'week';

export interface LeaderboardEntryDto {
  place: number;
  user: { shortId: number; nickname: string; avatarUrl: string | null; level: number };
  value: number;
  prize: number;
}

export interface LeaderboardDto {
  period: LeaderboardPeriod;
  periodStart: string;
  periodEnd: string;
  prizes: Array<{ from: number; to: number; amount: number }>;
  top: LeaderboardEntryDto[];
  me: { place: number | null; value: number } | null;
  previous: LeaderboardEntryDto[];
}

export interface LeaderboardsDto {
  day: LeaderboardDto | null;
  week: LeaderboardDto | null;
  serverTime: string;
}

// ---------- Ачивки ----------

export interface AchievementDto {
  code: string;
  name: string;
  description: string;
  icon: string;
  target: number;
  progress: number;
  unlockedAt: string | null;
}

// ---------- Уведомления ----------

export const NOTIFICATION_TYPES = [
  'deposit_succeeded',
  'level_up',
  'achievement',
  'battle_won',
  'battle_lost',
  'leaderboard_prize',
  'referral_reward',
  'promo_activated',
  'wheel_prize',
  'withdrawal_status',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  params: Record<string, string | number>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsDto {
  items: NotificationDto[];
  unread: number;
}

export const notificationsReadSchema = z
  .object({ ids: z.array(uuid).max(100).optional() })
  .strict();
export type NotificationsReadBody = z.infer<typeof notificationsReadSchema>;
