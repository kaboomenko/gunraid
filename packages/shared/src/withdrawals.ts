import { z } from 'zod';
import type { ItemDto } from './catalog.js';

export const WITHDRAWAL_STATUS_LIST = [
  'pending_review',
  'purchasing',
  'trade_sent',
  'trade_accepted',
  'awaiting_listing',
  'listing_submitted',
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'reversed',
] as const;
export type WithdrawalStatusCode = (typeof WITHDRAWAL_STATUS_LIST)[number];

/** Финальные статусы (дальше ничего не происходит). */
export const WITHDRAWAL_FINAL: WithdrawalStatusCode[] = [
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'reversed',
];

const uuid = z.string().uuid();

export const withdrawalCreateSchema = z.object({ userItemId: uuid }).strict();
export type WithdrawalCreateBody = z.infer<typeof withdrawalCreateSchema>;

export const withdrawalListingSchema = z
  .object({
    reference: z.string().trim().min(1).max(120),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type WithdrawalListingBody = z.infer<typeof withdrawalListingSchema>;

export interface WithdrawalEventDto {
  fromStatus: WithdrawalStatusCode | null;
  toStatus: WithdrawalStatusCode;
  actorType: 'user' | 'admin' | 'system' | 'provider';
  note: string | null;
  createdAt: string;
}

export interface WithdrawalDto {
  id: string;
  game: string;
  provider: string;
  status: WithdrawalStatusCode;
  item: ItemDto;
  value: number;
  target: { tradeUrl?: string; playerId?: string };
  priceGold: number | null;
  externalId: string | null;
  listing: { reference?: string; note?: string; submittedAt?: string } | null;
  reason: string | null;
  expiresAt: string | null;
  protectedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  events: WithdrawalEventDto[];
}

/** Что мешает выводу прямо сейчас (для подсказок в интерфейсе). */
export interface WithdrawalRequirementsDto {
  game: string;
  targetField: 'trade_url' | 'player_id';
  targetSet: boolean;
  steamRequired: boolean;
  steamLinked: boolean;
  depositedGems: number;
  minDepositGems: number;
  availableAt: string | null;
  newAccountLimit: number | null;
  newAccountUsedToday: number;
  so2GemsPerGold: number | null;
  so2ListingTimeoutMinutes: number;
}

// ---------- Админка: выводы ----------

export const adminWithdrawalApproveSchema = z
  .object({ priceGold: z.number().int().positive().max(100_000_000).optional() })
  .strict();
export const adminWithdrawalRejectSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const CS2_STUB_EVENTS = [
  'trade_sent',
  'trade_accepted',
  'trade_declined',
  'purchase_failed',
  'reverse',
  'complete',
] as const;
export type Cs2StubEvent = (typeof CS2_STUB_EVENTS)[number];
export const adminWithdrawalSimulateSchema = z.object({ event: z.enum(CS2_STUB_EVENTS) }).strict();
