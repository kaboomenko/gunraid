import { z } from 'zod';

export const LEDGER_TYPES = [
  'deposit',
  'deposit_bonus',
  'deposit_reversal',
  'case_open',
  'item_sell',
  'upgrade_stake',
  'battle_entry',
  'battle_refund',
  'wheel_prize',
  'promo_balance',
  'daily_bonus',
  'level_reward',
  'referral_reward',
  'leaderboard_prize',
  'admin_adjustment',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export interface TransactionDto {
  id: number;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  refType: string;
  refId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEPOSIT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'reversed',
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface PaymentCurrencyDto {
  code: string;
  kind: 'fiat' | 'crypto';
  /** Сколько долларов стоит 1 единица валюты (десятичная строка). */
  usdRate: string;
  /** Минимальная сумма в этой валюте (десятичная строка), чтобы получить минимум гемов. */
  minAmount: string;
  /** Быстрые суммы для кнопок. */
  presets: string[];
}

export interface PaymentMethodDto {
  code: string;
  provider: string;
  /** Тестовый провайдер — явно помечается в интерфейсе. */
  isTest: boolean;
  currencies: PaymentCurrencyDto[];
}

export interface PaymentMethodsDto {
  gemsPerUsd: number;
  minGems: number;
  maxGems: number;
  methods: PaymentMethodDto[];
}

export const depositQuoteSchema = z
  .object({
    method: z.string().min(1).max(32),
    currency: z.string().min(2).max(10),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,8})?$/),
  })
  .strict();
export type DepositQuoteBody = z.infer<typeof depositQuoteSchema>;

export interface DepositQuoteDto {
  quoteId: string;
  method: string;
  currency: string;
  amount: string;
  usdRate: string;
  gemsPerUsd: number;
  /** Сколько гемов будет начислено (без бонуса). */
  gems: number;
  /** Бонусные гемы (например, за первое пополнение). */
  bonusGems: number;
  bonusSource: string | null;
  expiresAt: string;
}

export const createDepositSchema = z.object({ quoteId: z.string().uuid() }).strict();

export interface DepositDto {
  id: string;
  status: DepositStatus;
  method: string;
  payCurrency: string;
  payAmount: string;
  gemsAmount: number;
  bonusGems: number;
  createdAt: string;
  completedAt: string | null;
  /** Куда отправить пользователя для оплаты (у тестового провайдера — страница сайта). */
  paymentUrl: string | null;
}

export const mockCompleteSchema = z.object({ result: z.enum(['success', 'fail']) }).strict();
