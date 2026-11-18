import { z } from 'zod';
import type { ItemDto } from './catalog.js';

export type CaseKind = 'paid' | 'free';

export interface CaseCardDto {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  accentColor: string;
  /** Цена в гемах (0 — бесплатный). */
  price: number;
  kind: CaseKind;
  minLevel: number | null;
  cooldownSeconds: number | null;
  supplyTotal: number | null;
  supplyUsed: number;
  categoryCode: string;
}

export interface CaseCategoryDto {
  code: string;
  name: string;
  cases: CaseCardDto[];
}

export interface BannerDto {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  link: string | null;
  accentColor: string;
}

export interface HomeDto {
  categories: CaseCategoryDto[];
  banners: BannerDto[];
}

export interface CaseContentItemDto {
  item: ItemDto;
  odds: number;
  /** Шанс в процентах (строка, до 5 знаков). */
  chance: string;
}

export const CASE_BLOCK_REASONS = ['LOGIN', 'ADULT', 'LEVEL', 'COOLDOWN', 'SOLD_OUT', 'UNAVAILABLE'] as const;
export type CaseBlockReason = (typeof CASE_BLOCK_REASONS)[number];

export interface CaseAvailabilityDto {
  canOpen: boolean;
  reason: CaseBlockReason | null;
  availableAt: string | null;
  levelRequired: number | null;
}

export interface CaseDetailDto extends CaseCardDto {
  description: string | null;
  revisionId: string;
  items: CaseContentItemDto[];
  availability: CaseAvailabilityDto;
  maxOpenCount: number;
}

export const openCaseSchema = z.object({ count: z.number().int().min(1).max(5) }).strict();
export type OpenCaseBody = z.infer<typeof openCaseSchema>;

export interface CaseOpenResultItemDto {
  openingId: string;
  userItemId: string;
  item: ItemDto;
  nonce: number;
  ticket: number;
}

export interface CaseOpenResultDto {
  batchId: string;
  caseId: string;
  balance: number;
  results: CaseOpenResultItemDto[];
  fair: { serverSeedHash: string; clientSeed: string };
  supplyUsed: number | null;
  supplyTotal: number | null;
  cooldownUntil: string | null;
}

export type DropSource = 'case' | 'upgrade' | 'contract' | 'battle' | 'wheel';

export interface FeedDropDto {
  id: string;
  game: string;
  source: DropSource;
  user: { shortId: number; nickname: string; avatarUrl: string | null };
  item: { id: string; skinName: string; modelName: string | null; imageUrl: string | null; rarityColor: string; price: number };
  caseSlug: string | null;
  caseName: string | null;
  caseImage: string | null;
  createdAt: string;
}
