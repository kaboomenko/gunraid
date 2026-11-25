import type { AdrenalineLevel } from '@gunraid/shared';

/**
 * Демо-кейсы. Платные — каталог из макета (названия, цены, картинки, уровни адреналина):
 * состав подбирается из каталога предметов под уровень адреналина при RTP 90%. Бонусные
 * (ежедневный, за уровень) — по диапазону цен, на главной не показываются (их открывают из
 * баннера и бонусов).
 */
export interface CaseSeed {
  slug: string;
  name: string;
  category: string;
  price: number;
  accent: string;
  /** Картинка из макета в apps/web/public/media/cases; без неё — демо-сундук (accent/secondary). */
  image?: string;
  secondary?: string;
  /** Явный состав по диапазону цен; без него состав подбирается под adrenaline. */
  pick?: { minPrice: number; maxPrice: number; count: number; types?: string[] };
  /** Целевой RTP платного кейса или ожидаемая стоимость (гемы) бесплатного. */
  target: number;
  kind?: 'paid' | 'free';
  minLevel?: number;
  cooldownHours?: number;
  supply?: number;
  /** Уровень адреналина из макета: на карточке — он, состав подбирается как можно ближе к нему. */
  adrenaline?: AdrenalineLevel;
  /** Сейф по редкости: предпочитаются предметы не ниже этой редкости (код редкости в игре). */
  rarity?: { standoff2: string; cs2: string };
  /** Сколько предметов в кейсе (по умолчанию 10). */
  count?: number;
}

export const CASE_CATEGORIES = [
  { code: 'snowfall', name: 'Операция: “Снегопад”', sortOrder: 1 },
  { code: 'easy', name: 'Лёгкий заход', sortOrder: 2 },
  { code: 'safes', name: 'Редкостные сейфы', sortOrder: 3 },
  { code: 'free', name: 'Бесплатные', sortOrder: 104 },
  { code: 'level', name: 'За уровень', sortOrder: 105 },
];

const paid = (
  slug: string,
  name: string,
  category: string,
  price: number,
  adrenaline: AdrenalineLevel,
  image: string,
  accent: string,
  extra: Partial<CaseSeed> = {},
): CaseSeed => ({ slug, name, category, price, adrenaline, image, accent, target: 0.9, ...extra });

/** Каталог из макета — одинаковый для обеих игр (состав — из предметов своей игры). */
export const MOCKUP_CASES: CaseSeed[] = [
  paid('stellar-start', 'Звёздный старт', 'snowfall', 39, 'low', 'stellar-start', '2A4A8C'),
  paid('polar-luck', 'Полярная удача', 'snowfall', 69, 'low', 'polar-luck', '7FD8FF'),
  paid('juicy-drop', 'Сочный дроп', 'snowfall', 129, 'low', 'juicy-drop', 'FF7A1A'),
  paid('luck-spark', 'Искра удачи', 'snowfall', 299, 'normal', 'luck-spark', 'E8C27A'),
  paid('generous-gift', 'Щедрый подарок', 'snowfall', 599, 'normal', 'generous-gift', 'D42A2A'),
  paid('festive-volley', 'Праздничный залп', 'snowfall', 999, 'normal', 'festive-volley', 'FF3EC9'),
  paid('snow-avalanche', 'Снежная лавина', 'snowfall', 1999, 'normal', 'snow-avalanche', 'E6EEF5'),
  paid(
    'christmas-miracle',
    'Рождественское чудо',
    'snowfall',
    3999,
    'normal',
    'christmas-miracle',
    '1E8A4A',
  ),
  paid('ice-crown', 'Ледяная корона', 'snowfall', 15999, 'high', 'ice-crown', 'BFE6FF'),
  paid('krampus-lair', 'Логово Крампуса', 'snowfall', 19999, 'high', 'krampus-lair', '8E1B2A'),
  paid('first-blood', 'Первая кровь', 'easy', 39, 'low', 'first-blood', 'D9C29A'),
  paid('pocket-drop', 'Карманный дроп', 'easy', 79, 'low', 'pocket-drop', 'C9A27A'),
  paid('raid-step', 'Шаг в рейд', 'easy', 249, 'low', 'raid-step', '6B7A3A'),
  paid('fresh-loot', 'Свежий трофей', 'easy', 999, 'normal', 'fresh-loot', '7A4A2A'),
  paid('stray-bullet', 'Шальная пуля', 'easy', 1299, 'normal', 'stray-bullet', '5A5F66'),
  paid('rare-safe', 'Редкие', 'safes', 89, 'normal', 'safe-blue', '2A68DC', {
    rarity: { standoff2: 'rare', cs2: 'milspec' },
  }),
  paid('epic-safe', 'Эпические', 'safes', 259, 'normal', 'safe-purple', '742ADC', {
    rarity: { standoff2: 'epic', cs2: 'restricted' },
  }),
  paid('legendary-safe', 'Легендарные', 'safes', 899, 'normal', 'safe-pink', 'DC2AC1', {
    rarity: { standoff2: 'legendary', cs2: 'classified' },
  }),
  paid('arcane-safe', 'Арканы', 'safes', 1799, 'high', 'safe-red', 'DC2A2A', {
    rarity: { standoff2: 'arcane', cs2: 'covert' },
  }),
  paid('nameless-safe', 'Nameless', 'safes', 75999, 'extreme', 'safe-yellow', 'DCBB2A', {
    rarity: { standoff2: 'nameless', cs2: 'rare_special' },
  }),
];

const SO2_BONUS_CASES: CaseSeed[] = [
  {
    slug: 'ezhednevnyy',
    name: 'Ежедневный',
    category: 'free',
    price: 0,
    accent: '39FF88',
    secondary: '2A2D36',
    pick: { minPrice: 4, maxPrice: 60, count: 6 },
    target: 10,
    kind: 'free',
    cooldownHours: 24,
  },
  {
    slug: 'uroven-5',
    name: 'Уровень 5',
    category: 'level',
    price: 0,
    accent: 'FF3EC9',
    secondary: '2A2D36',
    pick: { minPrice: 6, maxPrice: 240, count: 6 },
    target: 30,
    kind: 'free',
    minLevel: 5,
    cooldownHours: 24,
  },
];

const CS2_BONUS_CASES: CaseSeed[] = [
  {
    slug: 'ezhednevnyy',
    name: 'Ежедневный',
    category: 'free',
    price: 0,
    accent: '39FF88',
    secondary: '2A2D36',
    pick: { minPrice: 8, maxPrice: 85, count: 6 },
    target: 15,
    kind: 'free',
    cooldownHours: 24,
  },
  {
    slug: 'uroven-5',
    name: 'Уровень 5',
    category: 'level',
    price: 0,
    accent: 'C6FF00',
    secondary: '2A2D36',
    pick: { minPrice: 12, maxPrice: 350, count: 6 },
    target: 40,
    kind: 'free',
    minLevel: 5,
    cooldownHours: 24,
  },
];

export const SO2_CASES: CaseSeed[] = [...MOCKUP_CASES, ...SO2_BONUS_CASES];
export const CS2_CASES: CaseSeed[] = [...MOCKUP_CASES, ...CS2_BONUS_CASES];

export const BANNERS = [
  {
    title: 'Ежедневный кейс — бесплатно',
    subtitle: 'Новый бесплатный кейс каждые 24 часа',
    link: '/{game}/case/ezhednevnyy',
    accent: '#39FF88',
  },
  {
    title: 'Честная игра',
    subtitle: 'Проверьте результат любого открытия на странице Provably Fair',
    link: '/provably-fair',
    accent: '#C6FF00',
  },
];
