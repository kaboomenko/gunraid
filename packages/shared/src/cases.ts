import { z } from 'zod';
import type { ItemDto } from './catalog.js';

export type CaseKind = 'paid' | 'free';

/** «Уровень адреналина» кейса — насколько рискованно его открытие (фильтр на главной). */
export const ADRENALINE_LEVELS = ['low', 'normal', 'high', 'extreme'] as const;
export type AdrenalineLevel = (typeof ADRENALINE_LEVELS)[number];

/**
 * Пороги волатильности кейса: стандартное отклонение стоимости дропа, делённое на цену кейса
 * (у бесплатного — на ожидаемую стоимость). Чем больше разброс — тем реже окупается открытие
 * и тем крупнее возможный выигрыш.
 */
export const ADRENALINE_CV_THRESHOLDS = [1.5, 2.25, 2.75] as const;

export function caseAdrenaline(
  contents: ReadonlyArray<{ price: number; odds: number }>,
  casePrice: number,
): AdrenalineLevel {
  const total = contents.reduce((sum, c) => sum + Math.max(0, c.odds), 0);
  if (total <= 0) return 'normal';
  const ev = contents.reduce((sum, c) => sum + (Math.max(0, c.odds) / total) * c.price, 0);
  const reference = casePrice > 0 ? casePrice : ev;
  if (reference <= 0) return 'low';
  const variance = contents.reduce(
    (sum, c) => sum + (Math.max(0, c.odds) / total) * (c.price - ev) ** 2,
    0,
  );
  const cv = Math.sqrt(variance) / reference;
  const [low, normal, high] = ADRENALINE_CV_THRESHOLDS;
  if (cv < low) return 'low';
  if (cv < normal) return 'normal';
  if (cv < high) return 'high';
  return 'extreme';
}

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
  adrenaline: AdrenalineLevel;
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

export const CASE_BLOCK_REASONS = [
  'LOGIN',
  'ADULT',
  'LEVEL',
  'COOLDOWN',
  'SOLD_OUT',
  'UNAVAILABLE',
] as const;
export type CaseBlockReason = (typeof CASE_BLOCK_REASONS)[number];

export interface CaseAvailabilityDto {
  canOpen: boolean;
  reason: CaseBlockReason | null;
  availableAt: string | null;
  levelRequired: number | null;
  /** Бесплатные открытия этого кейса по бонусам (колесо, промокод, награды). */
  freeOpens: number;
}

export interface CaseDetailDto extends CaseCardDto {
  description: string | null;
  revisionId: string;
  items: CaseContentItemDto[];
  availability: CaseAvailabilityDto;
  maxOpenCount: number;
}

export const openCaseSchema = z
  .object({
    count: z.number().int().min(1).max(5),
    /** Открыть по бонусу «бесплатный кейс» (только x1). */
    useBonus: z.boolean().optional(),
  })
  .strict();
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
  /** Сколько бесплатных открытий этого кейса по бонусам осталось. */
  freeOpens: number;
}

export type DropSource = 'case' | 'upgrade' | 'contract' | 'battle' | 'wheel';

export interface FeedDropDto {
  id: string;
  game: string;
  source: DropSource;
  user: { shortId: number; nickname: string; avatarUrl: string | null };
  item: {
    id: string;
    skinName: string;
    modelName: string | null;
    imageUrl: string | null;
    rarityColor: string;
    price: number;
  };
  caseSlug: string | null;
  caseName: string | null;
  caseImage: string | null;
  createdAt: string;
}
