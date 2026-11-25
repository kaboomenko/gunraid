import { itemModels, itemTypes, items, rarities, type LocalizedText } from '@gunraid/db';
import { displayRarityColor, type ItemDto, type ItemWear, type RarityDto } from '@gunraid/shared';

export const DEFAULT_LOCALE = 'ru';

/** Текст из админки ({"ru": "…"}) на нужном языке с запасным вариантом. */
export function localize(value: LocalizedText | null | undefined, locale = DEFAULT_LOCALE): string {
  if (!value) return '';
  return value[locale] ?? Object.values(value)[0] ?? '';
}

/** Поля для выборки предмета вместе с редкостью, типом и моделью. */
export const itemColumns = {
  id: items.id,
  gameId: items.gameId,
  fullName: items.fullName,
  skinName: items.skinName,
  imageUrl: items.imageUrl,
  price: items.price,
  isStattrak: items.isStattrak,
  isSouvenir: items.isSouvenir,
  wear: items.wear,
  floatMin: items.floatMin,
  floatMax: items.floatMax,
  isWithdrawable: items.isWithdrawable,
  isActive: items.isActive,
  modelName: itemModels.name,
  typeCode: itemTypes.code,
  rarityCode: rarities.code,
  rarityName: rarities.name,
  rarityColor: rarities.color,
  raritySort: rarities.sortOrder,
};

export interface ItemRow {
  id: string;
  gameId: number;
  fullName: string;
  skinName: string;
  imageUrl: string | null;
  price: number;
  isStattrak: boolean;
  isSouvenir: boolean;
  wear: ItemWear | null;
  floatMin: string | null;
  floatMax: string | null;
  isWithdrawable: boolean;
  isActive: boolean;
  modelName: string | null;
  typeCode: string;
  rarityCode: string;
  rarityName: LocalizedText;
  rarityColor: string;
  raritySort: number;
}

export function toRarityDto(row: {
  code: string;
  name: LocalizedText;
  color: string;
  sortOrder: number;
}): RarityDto {
  return { code: row.code, name: localize(row.name), color: row.color, sortOrder: row.sortOrder };
}

export function toItemDto(row: ItemRow): ItemDto {
  return {
    id: row.id,
    fullName: row.fullName,
    skinName: row.skinName,
    modelName: row.modelName,
    typeCode: row.typeCode,
    rarity: {
      code: row.rarityCode,
      name: localize(row.rarityName),
      color: displayRarityColor(row.typeCode, row.rarityColor),
      sortOrder: row.raritySort,
    },
    imageUrl: row.imageUrl,
    price: row.price,
    isStattrak: row.isStattrak,
    isSouvenir: row.isSouvenir,
    wear: row.wear,
    floatMin: row.floatMin,
    floatMax: row.floatMax,
    isWithdrawable: row.isWithdrawable,
  };
}
