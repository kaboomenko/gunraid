/**
 * Демо-каталог для локального запуска. Названия скинов и коллекций — вымышленные,
 * картинки — собственные плейсхолдеры (/media/demo/<форма>.svg). Реальный каталог
 * загружается CSV-импортом через админку.
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

/** CS2 — по ТЗ (раздел 5). */
export const CS2_RARITIES: RaritySeed[] = [
  { code: 'consumer', name: 'Ширпотреб', color: '#B0C3D9' },
  { code: 'industrial', name: 'Промышленное качество', color: '#5E98D9' },
  { code: 'milspec', name: 'Армейское качество', color: '#4B69FF' },
  { code: 'restricted', name: 'Запрещённое', color: '#8847FF' },
  { code: 'classified', name: 'Засекреченное', color: '#D32CE6' },
  { code: 'covert', name: 'Тайное', color: '#EB4B4B' },
  { code: 'contraband', name: 'Контрабанда', color: '#E4AE39' },
  { code: 'rare_special', name: '★ Редкий особый предмет', color: '#FFD23F' },
];

/**
 * Standoff 2 — ЧЕРНОВИК. ТЗ требует сверить актуальный список редкостей и цветов с заказчиком.
 * Значения правятся в админке (таблица rarities) без изменения кода.
 */
export const SO2_RARITIES: RaritySeed[] = [
  { code: 'common', name: 'Обычное', color: '#B4BCC8' },
  { code: 'uncommon', name: 'Необычное', color: '#4DB8D9' },
  { code: 'rare', name: 'Редкое', color: '#3D6DFF' },
  { code: 'epic', name: 'Эпическое', color: '#8B4DFF' },
  { code: 'legendary', name: 'Легендарное', color: '#E03CC8' },
  { code: 'arcane', name: 'Аркана', color: '#FF4646' },
];

export interface ModelSeed {
  code: string;
  name: string;
  type: string;
  shape: Shape;
}

export const CS2_MODELS: ModelSeed[] = [
  { code: 'ak47', name: 'AK-47', type: 'weapon', shape: 'rifle' },
  { code: 'm4a4', name: 'M4A4', type: 'weapon', shape: 'rifle' },
  { code: 'm4a1s', name: 'M4A1-S', type: 'weapon', shape: 'rifle' },
  { code: 'awp', name: 'AWP', type: 'weapon', shape: 'sniper' },
  { code: 'ssg08', name: 'SSG 08', type: 'weapon', shape: 'sniper' },
  { code: 'deagle', name: 'Desert Eagle', type: 'weapon', shape: 'pistol' },
  { code: 'usps', name: 'USP-S', type: 'weapon', shape: 'pistol' },
  { code: 'glock18', name: 'Glock-18', type: 'weapon', shape: 'pistol' },
  { code: 'mp9', name: 'MP9', type: 'weapon', shape: 'smg' },
  { code: 'mac10', name: 'MAC-10', type: 'weapon', shape: 'smg' },
  { code: 'p90', name: 'P90', type: 'weapon', shape: 'smg' },
  { code: 'xm1014', name: 'XM1014', type: 'weapon', shape: 'shotgun' },
  { code: 'karambit', name: 'Karambit', type: 'knife', shape: 'knife' },
  { code: 'butterfly', name: 'Butterfly Knife', type: 'knife', shape: 'knife' },
  { code: 'm9', name: 'M9 Bayonet', type: 'knife', shape: 'knife' },
  { code: 'sport_gloves', name: 'Sport Gloves', type: 'gloves', shape: 'gloves' },
  { code: 'driver_gloves', name: 'Driver Gloves', type: 'gloves', shape: 'gloves' },
  { code: 'sticker', name: 'Sticker', type: 'sticker', shape: 'sticker' },
];

export const SO2_MODELS: ModelSeed[] = [
  { code: 'akr', name: 'AKR', type: 'weapon', shape: 'rifle' },
  { code: 'm4', name: 'M4', type: 'weapon', shape: 'rifle' },
  { code: 'm16', name: 'M16', type: 'weapon', shape: 'rifle' },
  { code: 'fnfal', name: 'FN FAL', type: 'weapon', shape: 'rifle' },
  { code: 'awm', name: 'AWM', type: 'weapon', shape: 'sniper' },
  { code: 'm110', name: 'M110', type: 'weapon', shape: 'sniper' },
  { code: 'deagle', name: 'Desert Eagle', type: 'weapon', shape: 'pistol' },
  { code: 'usp', name: 'USP', type: 'weapon', shape: 'pistol' },
  { code: 'g22', name: 'G22', type: 'weapon', shape: 'pistol' },
  { code: 'mp7', name: 'MP7', type: 'weapon', shape: 'smg' },
  { code: 'ump45', name: 'UMP45', type: 'weapon', shape: 'smg' },
  { code: 'p90', name: 'P90', type: 'weapon', shape: 'smg' },
  { code: 'sm1014', name: 'SM1014', type: 'weapon', shape: 'shotgun' },
  { code: 'karambit', name: 'Karambit', type: 'knife', shape: 'knife' },
  { code: 'butterfly', name: 'Butterfly', type: 'knife', shape: 'knife' },
  { code: 'kunai', name: 'Kunai', type: 'knife', shape: 'knife' },
  { code: 'tactical_gloves', name: 'Tactical Gloves', type: 'gloves', shape: 'gloves' },
  { code: 'sticker', name: 'Sticker', type: 'sticker', shape: 'sticker' },
  { code: 'charm', name: 'Charm', type: 'charm', shape: 'charm' },
  { code: 'graffiti', name: 'Graffiti', type: 'graffiti', shape: 'graffiti' },
];

export interface ItemSeed {
  model: string;
  skin: string;
  rarity: string;
  /** Цена в гемах. */
  price: number;
  colors: [string, string];
  wear?: Wear;
  stattrak?: boolean;
  collection?: string;
  withdrawable?: boolean;
}

const C = {
  lime: 'C6FF00',
  neon: '39FF88',
  pink: 'FF3EC9',
  red: 'FF4646',
  orange: 'FF8A1F',
  gold: 'FFD23F',
  ice: '7FD8FF',
  blue: '3D6DFF',
  violet: '8B4DFF',
  steel: '9AA4B2',
  dark: '2A2D36',
  sand: 'C9A66B',
  olive: '6B7A3A',
  white: 'EDEFF3',
} as const;

export const CS2_COLLECTIONS = [
  { code: 'raid', name: 'Raid Collection' },
  { code: 'neon', name: 'Neon District Collection' },
  { code: 'arctic', name: 'Arctic Ops Collection' },
];

export const CS2_ITEMS: ItemSeed[] = [
  { model: 'ak47', skin: 'Lime Fury', rarity: 'covert', price: 4890, wear: 'FT', colors: [C.lime, C.dark], collection: 'raid' },
  { model: 'ak47', skin: 'Lime Fury', rarity: 'covert', price: 7450, wear: 'MW', colors: [C.lime, C.dark], collection: 'raid' },
  { model: 'ak47', skin: 'Lime Fury', rarity: 'covert', price: 15900, wear: 'FT', stattrak: true, colors: [C.lime, C.dark], collection: 'raid' },
  { model: 'ak47', skin: 'Carbon Edge', rarity: 'classified', price: 1890, wear: 'FT', colors: [C.steel, C.dark], collection: 'neon' },
  { model: 'ak47', skin: 'Dust Storm', rarity: 'milspec', price: 190, wear: 'WW', colors: [C.sand, C.olive] },
  { model: 'm4a4', skin: 'Neon Raid', rarity: 'covert', price: 6290, wear: 'FT', colors: [C.neon, C.violet], collection: 'neon' },
  { model: 'm4a4', skin: 'Static Shock', rarity: 'restricted', price: 690, wear: 'MW', colors: [C.ice, C.blue] },
  { model: 'm4a1s', skin: 'Glacier', rarity: 'classified', price: 2390, wear: 'FN', colors: [C.ice, C.white], collection: 'arctic' },
  { model: 'm4a1s', skin: 'Night Ops', rarity: 'milspec', price: 240, wear: 'FT', colors: [C.dark, C.steel] },
  { model: 'awp', skin: 'Solar Flare', rarity: 'covert', price: 12900, wear: 'FT', colors: [C.orange, C.gold], collection: 'raid' },
  { model: 'awp', skin: 'Solar Flare', rarity: 'covert', price: 21500, wear: 'FN', colors: [C.orange, C.gold], collection: 'raid' },
  { model: 'awp', skin: 'Phantom', rarity: 'classified', price: 3490, wear: 'MW', colors: [C.violet, C.dark] },
  { model: 'awp', skin: 'Hex Grid', rarity: 'restricted', price: 890, wear: 'FT', colors: [C.lime, C.steel] },
  { model: 'ssg08', skin: 'Toxic Wave', rarity: 'restricted', price: 420, wear: 'FT', colors: [C.neon, C.dark] },
  { model: 'ssg08', skin: 'Arctic Camo', rarity: 'industrial', price: 45, wear: 'BS', colors: [C.white, C.ice] },
  { model: 'deagle', skin: 'Ember Line', rarity: 'classified', price: 1490, wear: 'MW', colors: [C.red, C.orange] },
  { model: 'deagle', skin: 'Ironclad', rarity: 'milspec', price: 160, wear: 'FT', colors: [C.steel, C.dark] },
  { model: 'usps', skin: 'Overdrive', rarity: 'classified', price: 1290, wear: 'FT', colors: [C.pink, C.violet], collection: 'neon' },
  { model: 'usps', skin: 'Circuit', rarity: 'restricted', price: 380, wear: 'MW', colors: [C.lime, C.blue] },
  { model: 'glock18', skin: 'Venom', rarity: 'restricted', price: 350, wear: 'FT', colors: [C.neon, C.olive] },
  { model: 'glock18', skin: 'Blackout', rarity: 'milspec', price: 120, wear: 'FT', colors: [C.dark, C.steel] },
  { model: 'glock18', skin: 'Desert Camo', rarity: 'consumer', price: 12, wear: 'BS', colors: [C.sand, C.olive] },
  { model: 'mp9', skin: 'Hex Grid', rarity: 'milspec', price: 95, wear: 'FT', colors: [C.lime, C.dark] },
  { model: 'mp9', skin: 'Rust Bucket', rarity: 'consumer', price: 8, wear: 'WW', colors: [C.orange, C.dark] },
  { model: 'mac10', skin: 'Neon Raid', rarity: 'restricted', price: 310, wear: 'MW', colors: [C.pink, C.neon] },
  { model: 'mac10', skin: 'Arctic Camo', rarity: 'industrial', price: 22, wear: 'FT', colors: [C.white, C.ice] },
  { model: 'p90', skin: 'Static Shock', rarity: 'milspec', price: 140, wear: 'FT', colors: [C.ice, C.violet] },
  { model: 'p90', skin: 'Dust Storm', rarity: 'consumer', price: 10, wear: 'BS', colors: [C.sand, C.dark] },
  { model: 'xm1014', skin: 'Ember Line', rarity: 'milspec', price: 85, wear: 'FT', colors: [C.red, C.dark] },
  { model: 'xm1014', skin: 'Night Ops', rarity: 'industrial', price: 18, wear: 'WW', colors: [C.dark, C.steel] },
  { model: 'karambit', skin: 'Lime Fury', rarity: 'rare_special', price: 128000, wear: 'FN', colors: [C.lime, C.dark] },
  { model: 'karambit', skin: 'Glacier', rarity: 'rare_special', price: 74500, wear: 'FT', colors: [C.ice, C.white] },
  { model: 'butterfly', skin: 'Solar Flare', rarity: 'rare_special', price: 96000, wear: 'MW', colors: [C.orange, C.gold] },
  { model: 'butterfly', skin: 'Night Ops', rarity: 'rare_special', price: 58900, wear: 'FT', colors: [C.dark, C.steel] },
  { model: 'm9', skin: 'Neon Raid', rarity: 'rare_special', price: 64900, wear: 'FT', colors: [C.neon, C.violet] },
  { model: 'm9', skin: 'Desert Camo', rarity: 'rare_special', price: 39900, wear: 'WW', colors: [C.sand, C.olive] },
  { model: 'sport_gloves', skin: 'Toxic Wave', rarity: 'rare_special', price: 54900, wear: 'FT', colors: [C.neon, C.dark] },
  { model: 'sport_gloves', skin: 'Overdrive', rarity: 'rare_special', price: 82500, wear: 'MW', colors: [C.pink, C.violet] },
  { model: 'driver_gloves', skin: 'Ironclad', rarity: 'rare_special', price: 31900, wear: 'FT', colors: [C.steel, C.sand] },
  { model: 'sticker', skin: 'GunRaid Holo', rarity: 'classified', price: 990, colors: [C.lime, C.violet] },
  { model: 'sticker', skin: 'Headshot', rarity: 'restricted', price: 260, colors: [C.red, C.white] },
  { model: 'sticker', skin: 'Lime Skull', rarity: 'milspec', price: 65, colors: [C.lime, C.dark] },
  { model: 'sticker', skin: 'Pixel Crown', rarity: 'industrial', price: 15, colors: [C.gold, C.dark] },
  { model: 'ak47', skin: 'Circuit', rarity: 'contraband', price: 48500, wear: 'MW', colors: [C.gold, C.lime] },
  { model: 'm4a1s', skin: 'Overdrive', rarity: 'covert', price: 5390, wear: 'FT', colors: [C.pink, C.dark] },
  { model: 'usps', skin: 'Glacier', rarity: 'industrial', price: 30, wear: 'FT', colors: [C.ice, C.steel] },
];

export const SO2_COLLECTIONS = [
  { code: 'origin', name: 'Origin Collection' },
  { code: 'rival', name: 'Rival Collection' },
];

export const SO2_ITEMS: ItemSeed[] = [
  { model: 'akr', skin: 'Lime Fury', rarity: 'arcane', price: 9890, colors: [C.lime, C.dark], collection: 'origin' },
  { model: 'akr', skin: 'Lime Fury', rarity: 'arcane', price: 18900, stattrak: true, colors: [C.lime, C.dark], collection: 'origin' },
  { model: 'akr', skin: 'Carbon Edge', rarity: 'legendary', price: 2890, colors: [C.steel, C.dark] },
  { model: 'akr', skin: 'Dust Storm', rarity: 'rare', price: 240, colors: [C.sand, C.olive] },
  { model: 'm4', skin: 'Neon Raid', rarity: 'legendary', price: 3190, colors: [C.neon, C.violet], collection: 'rival' },
  { model: 'm4', skin: 'Night Ops', rarity: 'uncommon', price: 55, colors: [C.dark, C.steel] },
  { model: 'm16', skin: 'Static Shock', rarity: 'epic', price: 690, colors: [C.ice, C.blue] },
  { model: 'm16', skin: 'Arctic Camo', rarity: 'common', price: 9, colors: [C.white, C.ice] },
  { model: 'fnfal', skin: 'Ember Line', rarity: 'epic', price: 820, colors: [C.red, C.orange] },
  { model: 'fnfal', skin: 'Rust Bucket', rarity: 'uncommon', price: 38, colors: [C.orange, C.dark] },
  { model: 'awm', skin: 'Solar Flare', rarity: 'arcane', price: 14900, colors: [C.orange, C.gold], collection: 'origin' },
  { model: 'awm', skin: 'Phantom', rarity: 'legendary', price: 4590, colors: [C.violet, C.dark] },
  { model: 'awm', skin: 'Hex Grid', rarity: 'epic', price: 990, colors: [C.lime, C.steel] },
  { model: 'm110', skin: 'Toxic Wave', rarity: 'rare', price: 310, colors: [C.neon, C.dark] },
  { model: 'm110', skin: 'Desert Camo', rarity: 'common', price: 7, colors: [C.sand, C.olive] },
  { model: 'deagle', skin: 'Ember Line', rarity: 'legendary', price: 2490, colors: [C.red, C.dark] },
  { model: 'deagle', skin: 'Ironclad', rarity: 'rare', price: 180, colors: [C.steel, C.dark] },
  { model: 'usp', skin: 'Overdrive', rarity: 'epic', price: 760, colors: [C.pink, C.violet], collection: 'rival' },
  { model: 'usp', skin: 'Circuit', rarity: 'uncommon', price: 42, colors: [C.lime, C.blue] },
  { model: 'g22', skin: 'Venom', rarity: 'rare', price: 210, colors: [C.neon, C.olive] },
  { model: 'g22', skin: 'Blackout', rarity: 'common', price: 6, colors: [C.dark, C.steel] },
  { model: 'mp7', skin: 'Hex Grid', rarity: 'rare', price: 160, colors: [C.lime, C.dark] },
  { model: 'mp7', skin: 'Glacier', rarity: 'uncommon', price: 35, colors: [C.ice, C.white] },
  { model: 'ump45', skin: 'Neon Raid', rarity: 'epic', price: 540, colors: [C.pink, C.neon] },
  { model: 'ump45', skin: 'Arctic Camo', rarity: 'common', price: 8, colors: [C.white, C.ice] },
  { model: 'p90', skin: 'Static Shock', rarity: 'rare', price: 190, colors: [C.ice, C.violet] },
  { model: 'sm1014', skin: 'Ember Line', rarity: 'uncommon', price: 48, colors: [C.red, C.dark] },
  { model: 'sm1014', skin: 'Dust Storm', rarity: 'common', price: 5, colors: [C.sand, C.dark] },
  { model: 'karambit', skin: 'Lime Fury', rarity: 'arcane', price: 89900, colors: [C.lime, C.dark] },
  { model: 'karambit', skin: 'Glacier', rarity: 'legendary', price: 41900, colors: [C.ice, C.white] },
  { model: 'butterfly', skin: 'Solar Flare', rarity: 'arcane', price: 67900, colors: [C.orange, C.gold] },
  { model: 'butterfly', skin: 'Night Ops', rarity: 'legendary', price: 32900, colors: [C.dark, C.steel] },
  { model: 'kunai', skin: 'Neon Raid', rarity: 'legendary', price: 21900, colors: [C.neon, C.violet] },
  { model: 'kunai', skin: 'Rust Bucket', rarity: 'epic', price: 9900, colors: [C.orange, C.dark] },
  { model: 'tactical_gloves', skin: 'Toxic Wave', rarity: 'legendary', price: 26900, colors: [C.neon, C.dark] },
  { model: 'tactical_gloves', skin: 'Overdrive', rarity: 'arcane', price: 44900, colors: [C.pink, C.violet] },
  { model: 'sticker', skin: 'GunRaid Holo', rarity: 'epic', price: 450, colors: [C.lime, C.violet] },
  { model: 'sticker', skin: 'Headshot', rarity: 'rare', price: 120, colors: [C.red, C.white] },
  { model: 'sticker', skin: 'Pixel Crown', rarity: 'common', price: 6, colors: [C.gold, C.dark] },
  { model: 'charm', skin: 'Lime Bullet', rarity: 'epic', price: 590, colors: [C.lime, C.steel] },
  { model: 'charm', skin: 'Tiny Crate', rarity: 'rare', price: 140, colors: [C.gold, C.dark] },
  { model: 'charm', skin: 'Dice', rarity: 'uncommon', price: 28, colors: [C.white, C.red] },
  { model: 'graffiti', skin: 'Raid Tag', rarity: 'uncommon', price: 22, colors: [C.lime, C.dark] },
  { model: 'graffiti', skin: 'GG', rarity: 'common', price: 4, colors: [C.pink, C.dark] },
];

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
