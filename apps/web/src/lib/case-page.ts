import type { CaseCategoryDto, CaseContentItemDto, ItemDto } from '@gunraid/shared';

export interface CaseNeighbour {
  slug: string;
  name: string;
  imageUrl: string | null;
}

export interface CaseNeighbours {
  prev: CaseNeighbour;
  next: CaseNeighbour;
}

/**
 * Соседние кейсы на странице кейса: порядок — как в каталоге на главной (категории по порядку,
 * кейсы внутри по порядку, без бесплатных — в сетке главной их тоже нет), по кругу: у первого
 * кейса слева последний. Кейса в этом списке нет (бесплатный, снятый с витрины) или он там
 * один — соседей и стрелок нет.
 */
export function caseNeighbours(
  categories: readonly CaseCategoryDto[],
  slug: string,
): CaseNeighbours | null {
  const list = categories.flatMap((c) => c.cases).filter((c) => c.kind !== 'free');
  const i = list.findIndex((c) => c.slug === slug);
  if (i < 0 || list.length < 2) return null;
  const at = (k: number): CaseNeighbour => {
    const c = list[(k + list.length) % list.length]!;
    return { slug: c.slug, name: c.name, imageUrl: c.imageUrl };
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

/**
 * Шанс на карточке предмета (без знака %): точка как в макете («0.58»), два знака после точки;
 * у совсем редких предметов (меньше 0,01%) — две значащие цифры, чтобы не превращались в «0.00».
 */
export function formatChance(chance: string | number): string {
  const n = typeof chance === 'number' ? chance : Number(chance);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 0.01) return n.toFixed(2);
  return String(Number(n.toPrecision(2)));
}

/** Лента рулетки: 54 карточки, выигрыш (решён сервером) — на позиции 46. */
export const STRIP_LENGTH = 54;
export const WIN_INDEX = 46;
/**
 * Дроплента телефона в покое: первые IDLE_LENGTH карточек ленты следующей прокрутки, под меткой — карточка
 * IDLE_INDEX (CSS-сдвиг .case-strip__track берёт её из --idle). Прокрутка начинается с той же карточки.
 */
export const IDLE_INDEX = 5;
export const IDLE_LENGTH = 11;

/** seed дорожки lane прокрутки spinId: у каждой дорожки свой, чтобы при x2…x5 ленты не повторяли друг друга. */
export function laneSeed(spinId: number, lane: number): number {
  return spinId * 9301 + 49297 + lane * 7919;
}

/**
 * seed ленты дропленты (телефон): laneSeed через смеситель — финализатор MurmurHash3. У генератора buildStrip
 * (Park–Miller) seed с постоянным шагом дают ту же последовательность со сдвигом на постоянную величину, и соседние
 * ленты x2…x5 в витрине почти совпадали: в среднем 4 общие позиции из 11 вместо 2, под меткой — в каждой второй.
 * Рулетка сцены (планшет и десктоп) — по-прежнему laneSeed. Ленты дропленты берут seed через stripSeeds.
 */
export function stripSeed(spinId: number, lane: number): number {
  let h = laneSeed(spinId, lane) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Косметическая лента: наполнители по шансам кейса, выигрыш (решённый сервером) — на позиции
 * WIN_INDEX; без выигрыша (null) — витрина дропленты. Выигрыш ставится после розыгрыша наполнителей,
 * поэтому начало ленты от него не зависит: витрина в покое = начало ленты следующей прокрутки.
 */
export function buildStrip(
  pool: readonly CaseContentItemDto[],
  winner: ItemDto | null,
  seed: number,
): CaseContentItemDto[] {
  if (!pool.length) return [];
  let x = seed % 2147483647 || 1;
  const rand = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const total = pool.reduce((s, p) => s + p.odds, 0);
  const pick = () => {
    let r = rand() * total;
    for (const p of pool) {
      r -= p.odds;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1] as CaseContentItemDto;
  };
  const strip = Array.from({ length: STRIP_LENGTH }, (_, i) => {
    // Чуть чаще показываем самые ценные предметы (они первые в составе), чтобы лента выглядела живой.
    if (i % 7 === 3)
      return pool[Math.floor(rand() * Math.min(3, pool.length))] as CaseContentItemDto;
    return pick();
  });
  if (winner) {
    const entry = pool.find((p) => p.item.id === winner.id);
    strip[WIN_INDEX] = { item: winner, odds: entry?.odds ?? 0, chance: entry?.chance ?? '' };
  }
  return strip;
}

/** Соседние ленты дропленты делят не больше стольких позиций витрины из IDLE_LENGTH — иначе лента выглядит копией. */
export const STRIP_MAX_SHARED = 8;

/**
 * seed лент дропленты прокрутки spinId (count лент): у каждой — stripSeed, но если её витрина повторяет витрину ленты
 * выше больше чем на STRIP_MAX_SHARED позициях, берётся seed запасной дорожки (lane + 5k, k до 8; не подошла ни
 * одна — наименее похожая). Так бывает и у независимых лент, когда у кейса один частый предмет (при 75 % — в среднем
 * 6 общих позиций из 11, 9 и больше — в 5–6 % пар). seed ленты зависит только от лент выше, поэтому витрина (count
 * лент) и прокрутка (столько же лент или одна — бонус) начинаются одинаково; SSR и браузер считают одно и то же.
 */
export function stripSeeds(
  pool: readonly CaseContentItemDto[],
  spinId: number,
  count: number,
): number[] {
  const showcase = (seed: number) =>
    buildStrip(pool, null, seed)
      .slice(0, IDLE_LENGTH)
      .map((e) => e.item.id);
  const seeds: number[] = [];
  let above: string[] = [];
  for (let lane = 0; lane < count; lane++) {
    const top = above;
    let best = { seed: 0, cards: [] as string[], shared: Infinity };
    for (let k = 0; k <= 8 && best.shared > STRIP_MAX_SHARED; k++) {
      const seed = stripSeed(spinId, lane + 5 * k);
      const cards = showcase(seed);
      const shared = cards.filter((id, i) => id === top[i]).length;
      if (shared < best.shared) best = { seed, cards, shared };
    }
    seeds.push(best.seed);
    above = best.cards;
  }
  return seeds;
}

/** Геометрия ленты из разметки: размер карточки по оси ленты, шаг (между началами соседних), размер окна. */
export interface ReelGeometry {
  card: number;
  pitch: number;
  view: number;
}

/**
 * Сдвиг ленты, при котором центр карточки i стоит под меткой (по центру окна): x — лента едет влево
 * (сдвиг отрицательный), y — дорожка привязана к низу окна и едет вниз (сдвиг положительный).
 */
export function reelOffset(i: number, g: ReelGeometry, axis: 'x' | 'y' = 'x'): number {
  const centre = i * g.pitch + g.card / 2;
  return axis === 'x' ? g.view / 2 - centre : centre - g.view / 2;
}
