import { z } from 'zod';
import type { ItemDto } from './catalog.js';

export const USER_ITEM_STATUSES = [
  'in_inventory',
  'sold',
  'withdrawing',
  'withdrawn',
  'used_upgrade',
  'used_contract',
  'lost_battle',
] as const;
export type UserItemStatus = (typeof USER_ITEM_STATUSES)[number];

export const ITEM_SOURCES = [
  'case',
  'upgrade',
  'contract',
  'battle',
  'wheel',
  'promo',
  'level_reward',
  'leaderboard',
  'admin',
  'seed',
] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

export interface UserItemDto {
  id: string;
  status: UserItemStatus;
  source: ItemSource;
  acquiredValue: number;
  acquiredAt: string;
  soldValue: number | null;
  item: ItemDto;
}

export const INVENTORY_SORTS = ['date_desc', 'date_asc', 'price_desc', 'price_asc', 'rarity_desc'] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

export const inventoryQuerySchema = z.object({
  status: z.enum(['in_inventory', 'all']).default('in_inventory'),
  sort: z.enum(INVENTORY_SORTS).default('date_desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
});
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export interface InventoryPageDto {
  items: UserItemDto[];
  total: number;
  /** Суммарная текущая стоимость предметов в инвентаре (гемы). */
  totalValue: number;
  page: number;
  pageSize: number;
}

export const sellSchema = z.union([
  z.object({ userItemIds: z.array(z.string().uuid()).min(1).max(500) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type SellBody = z.infer<typeof sellSchema>;

export interface SellResultDto {
  soldCount: number;
  /** Начислено гемов. */
  total: number;
  balance: number;
  soldIds: string[];
}
