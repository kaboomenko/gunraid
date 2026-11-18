import { z } from 'zod';

export const ITEM_WEARS = ['FN', 'MW', 'FT', 'WW', 'BS'] as const;
export type ItemWear = (typeof ITEM_WEARS)[number];

export interface RarityDto {
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface ItemDto {
  id: string;
  fullName: string;
  skinName: string;
  modelName: string | null;
  typeCode: string;
  rarity: RarityDto;
  imageUrl: string | null;
  /** Цена в гемах. */
  price: number;
  isStattrak: boolean;
  isSouvenir: boolean;
  wear: ItemWear | null;
  floatMin: string | null;
  floatMax: string | null;
  isWithdrawable: boolean;
}

export interface ItemCaseRefDto {
  slug: string;
  name: string;
  imageUrl: string | null;
  price: number;
  /** Шанс в процентах (строка с точностью до 0,00001). */
  chance: string;
}

export interface ItemDetailDto extends ItemDto {
  collection: string | null;
  cases: ItemCaseRefDto[];
}

export const ITEM_SORTS = ['price_desc', 'price_asc', 'rarity_desc', 'name_asc', 'newest'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

const csv = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

export const itemsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  rarity: csv.optional(),
  type: csv.optional(),
  model: csv.optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  stattrak: z.enum(['true', 'false']).optional(),
  sort: z.enum(ITEM_SORTS).default('price_desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(120).default(48),
});
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;

export interface ItemsPageDto {
  items: ItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemFacetsDto {
  rarities: RarityDto[];
  types: Array<{ code: string; name: string; count: number }>;
  models: Array<{ code: string; name: string; typeCode: string; count: number }>;
  priceMin: number;
  priceMax: number;
}
