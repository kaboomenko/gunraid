/** Демо-кейсы. Состав подбирается из каталога по ценовому диапазону, шансы — под целевой RTP. */
export interface CaseSeed {
  slug: string;
  name: string;
  category: string;
  price: number;
  accent: string;
  secondary: string;
  pick: { minPrice: number; maxPrice: number; count: number; types?: string[] };
  /** Целевой RTP платного кейса или ожидаемая стоимость (гемы) бесплатного. */
  target: number;
  kind?: 'paid' | 'free';
  minLevel?: number;
  cooldownHours?: number;
  supply?: number;
}

export const CASE_CATEGORIES = [
  { code: 'popular', name: 'Популярные', sortOrder: 1 },
  { code: 'premium', name: 'Премиальные', sortOrder: 2 },
  { code: 'limited', name: 'Лимитированные', sortOrder: 3 },
  { code: 'free', name: 'Бесплатные', sortOrder: 4 },
  { code: 'level', name: 'За уровень', sortOrder: 5 },
];

export const SO2_CASES: CaseSeed[] = [
  {
    slug: 'novobranets',
    name: 'Новобранец',
    category: 'popular',
    price: 49,
    accent: '7FD8FF',
    secondary: '2A2D36',
    pick: { minPrice: 4, maxPrice: 690, count: 9 },
    target: 0.9,
  },
  {
    slug: 'lime-rush',
    name: 'Лайм-раш',
    category: 'popular',
    price: 149,
    accent: 'C6FF00',
    secondary: '2A2D36',
    pick: { minPrice: 5, maxPrice: 3200, count: 10 },
    target: 0.9,
  },
  {
    slug: 'raid',
    name: 'Рейд',
    category: 'popular',
    price: 399,
    accent: 'FF8A1F',
    secondary: '2A2D36',
    pick: { minPrice: 22, maxPrice: 9890, count: 10 },
    target: 0.9,
  },
  {
    slug: 'arsenal',
    name: 'Арсенал',
    category: 'premium',
    price: 990,
    accent: '8B4DFF',
    secondary: '1B1B22',
    pick: { minPrice: 160, maxPrice: 21900, count: 9 },
    target: 0.9,
  },
  {
    slug: 'klinok',
    name: 'Клинок',
    category: 'premium',
    price: 2490,
    accent: 'FF4646',
    secondary: '1B1B22',
    pick: { minPrice: 540, maxPrice: 89900, count: 8 },
    target: 0.9,
  },
  {
    slug: 'nulevoy-tirazh',
    name: 'Нулевой тираж',
    category: 'limited',
    price: 690,
    accent: 'FFD23F',
    secondary: '2A2D36',
    pick: { minPrice: 35, maxPrice: 14900, count: 9 },
    target: 0.92,
    supply: 500,
  },
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

export const CS2_CASES: CaseSeed[] = [
  {
    slug: 'novobranets',
    name: 'Новобранец',
    category: 'popular',
    price: 49,
    accent: '7FD8FF',
    secondary: '2A2D36',
    pick: { minPrice: 8, maxPrice: 690, count: 9 },
    target: 0.9,
  },
  {
    slug: 'neon-district',
    name: 'Неоновый район',
    category: 'popular',
    price: 199,
    accent: 'FF3EC9',
    secondary: '2A2D36',
    pick: { minPrice: 10, maxPrice: 4890, count: 10 },
    target: 0.9,
  },
  {
    slug: 'raid',
    name: 'Рейд',
    category: 'popular',
    price: 499,
    accent: 'FF8A1F',
    secondary: '2A2D36',
    pick: { minPrice: 22, maxPrice: 12900, count: 10 },
    target: 0.9,
  },
  {
    slug: 'arsenal',
    name: 'Арсенал',
    category: 'premium',
    price: 1490,
    accent: '8B4DFF',
    secondary: '1B1B22',
    pick: { minPrice: 140, maxPrice: 31900, count: 9 },
    target: 0.9,
  },
  {
    slug: 'klinok',
    name: 'Клинок',
    category: 'premium',
    price: 3990,
    accent: 'FF4646',
    secondary: '1B1B22',
    pick: { minPrice: 890, maxPrice: 128000, count: 9 },
    target: 0.9,
  },
  {
    slug: 'nulevoy-tirazh',
    name: 'Нулевой тираж',
    category: 'limited',
    price: 990,
    accent: 'FFD23F',
    secondary: '2A2D36',
    pick: { minPrice: 45, maxPrice: 21500, count: 9 },
    target: 0.92,
    supply: 300,
  },
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
