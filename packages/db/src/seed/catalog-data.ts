/**
 * Справочники демо-каталога: типы предметов, редкости, износ, курсы.
 * Сами модели и скины (настоящие, с картинками) — в real-catalog.ts (генерируется скриптом).
 */
export type Wear = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
export type Shape =
  | 'rifle'
  | 'sniper'
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'knife'
  | 'gloves'
  | 'sticker'
  | 'charm'
  | 'graffiti';

export const ITEM_TYPE_ROWS = [
  { code: 'weapon', name: { ru: 'Оружие' }, sortOrder: 1 },
  { code: 'knife', name: { ru: 'Нож' }, sortOrder: 2 },
  { code: 'gloves', name: { ru: 'Перчатки' }, sortOrder: 3 },
  { code: 'sticker', name: { ru: 'Наклейка' }, sortOrder: 4 },
  { code: 'charm', name: { ru: 'Брелок' }, sortOrder: 5 },
  { code: 'graffiti', name: { ru: 'Граффити' }, sortOrder: 6 },
];

export interface RaritySeed {
  code: string;
  name: string;
  color: string;
}

/** CS2 — названия по ТЗ (раздел 5), цвета — из дизайн-макета. */
export const CS2_RARITIES: RaritySeed[] = [
  { code: 'consumer', name: 'Ширпотреб', color: '#6D8588' },
  { code: 'industrial', name: 'Промышленное качество', color: '#5FACD2' },
  { code: 'milspec', name: 'Армейское качество', color: '#2A68DC' },
  { code: 'restricted', name: 'Запрещённое', color: '#742ADC' },
  { code: 'classified', name: 'Засекреченное', color: '#DC2AC1' },
  { code: 'covert', name: 'Тайное', color: '#DC2A2A' },
  { code: 'contraband', name: 'Контрабанда', color: '#DCBB2A' },
  { code: 'rare_special', name: 'Крайне редкий предмет', color: '#DCBB2A' },
];

/**
 * Standoff 2 — цвета из дизайн-макета (коммон … арканы, Nameless).
 * Значения правятся в админке (таблица rarities) без изменения кода.
 */
export const SO2_RARITIES: RaritySeed[] = [
  { code: 'common', name: 'Обычное', color: '#6D8588' },
  { code: 'uncommon', name: 'Необычное', color: '#5FACD2' },
  { code: 'rare', name: 'Редкое', color: '#2A68DC' },
  { code: 'epic', name: 'Эпическое', color: '#742ADC' },
  { code: 'legendary', name: 'Легендарное', color: '#DC2AC1' },
  { code: 'arcane', name: 'Аркана', color: '#DC2A2A' },
  { code: 'nameless', name: 'Nameless', color: '#DCBB2A' },
];

export interface ModelSeed {
  code: string;
  name: string;
  type: string;
  shape: Shape;
}

export interface ItemSeed {
  model: string;
  skin: string;
  rarity: string;
  /** Цена в гемах. */
  price: number;
  /** Картинка из public (например /media/skins/cs2/ak47-redline.webp). */
  image?: string;
  /** Цвета собственного плейсхолдера, если картинки нет. */
  colors?: [string, string];
  wear?: Wear;
  stattrak?: boolean;
  collection?: string;
  withdrawable?: boolean;
}

export const WEAR_LABELS: Record<Wear, string> = {
  FN: 'Factory New',
  MW: 'Minimal Wear',
  FT: 'Field-Tested',
  WW: 'Well-Worn',
  BS: 'Battle-Scarred',
};

export const WEAR_FLOATS: Record<Wear, [string, string]> = {
  FN: ['0.00000', '0.07000'],
  MW: ['0.07000', '0.15000'],
  FT: ['0.15000', '0.38000'],
  WW: ['0.38000', '0.45000'],
  BS: ['0.45000', '1.00000'],
};

/** Курсы для ТЕСТОВОГО пополнения (правятся в админке; позже — от провайдера). */
export const TEST_FX_RATES = [
  { currency: 'USD', kind: 'fiat', usdRate: '1', sortOrder: 1 },
  { currency: 'RUB', kind: 'fiat', usdRate: '0.0125', sortOrder: 2 },
  { currency: 'UAH', kind: 'fiat', usdRate: '0.024', sortOrder: 3 },
  { currency: 'USDT', kind: 'crypto', usdRate: '1', sortOrder: 4 },
];
