import { z } from 'zod';
import type { ItemDto } from './catalog.js';

// ---------- Апгрейд ----------

export interface UpgradeConfigDto {
  commission: number;
  maxChance: number;
  minChance: number;
  multipliers: number[];
}

const uuid = z.string().uuid();

export const upgradeSchema = z.union([
  z.object({ userItemIds: z.array(uuid).min(1).max(10), targetItemId: uuid }).strict(),
  z.object({ amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), targetItemId: uuid }).strict(),
]);
export type UpgradeBody = z.infer<typeof upgradeSchema>;

export const upgradeTargetsQuerySchema = z.object({
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['price_asc', 'price_desc']).default('price_asc'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(30),
});
export type UpgradeTargetsQuery = z.infer<typeof upgradeTargetsQuerySchema>;

export interface FairRefDto {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface UpgradeResultDto {
  id: string;
  isWin: boolean;
  /** Шанс и бросок в миллионных (1 000 000 = 100 %). */
  chance: number;
  roll: number;
  stakeValue: number;
  target: ItemDto;
  resultUserItemId: string | null;
  balance: number;
  fair: FairRefDto;
}

export interface UpgradeHistoryDto {
  id: string;
  isWin: boolean;
  chance: number;
  stakeValue: number;
  target: ItemDto;
  createdAt: string;
}

// ---------- Контракт ----------

export interface ContractConfigDto {
  commission: number;
  coefMin: number;
  coefMax: number;
  minItems: number;
  maxItems: number;
  /** Вероятность получить больше вложенного. */
  winProbability: number;
}

export const contractSchema = z.object({ userItemIds: z.array(uuid).min(2).max(20) }).strict();
export type ContractBody = z.infer<typeof contractSchema>;

export interface ContractResultDto {
  id: string;
  inputValue: number;
  min: number;
  max: number;
  multiplier: number;
  targetValue: number;
  result: ItemDto;
  resultUserItemId: string;
  fair: FairRefDto;
}

export interface ContractHistoryDto {
  id: string;
  inputValue: number;
  multiplier: number;
  result: ItemDto;
  createdAt: string;
}

// ---------- Проверка ----------

export interface UpgradeProofDto {
  type: 'upgrade';
  id: string;
  revealed: boolean;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  chance: number;
  roll: number;
  isWin: boolean;
  createdAt: string;
}

export interface ContractProofDto {
  type: 'contract';
  id: string;
  revealed: boolean;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  coefMin: number;
  coefMax: number;
  gamma: number;
  multiplier: number;
  inputValue: number;
  targetValue: number;
  createdAt: string;
}
