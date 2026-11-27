import type { AdrenalineLevel, CaseCategoryDto } from '@gunraid/shared';

/** Фильтры витрины кейсов главной. Цена — строки из полей ввода: пустое поле — без границы. */
export interface CaseFilters {
  /** Код категории или 'all'. */
  category: string;
  query: string;
  min: string;
  max: string;
  level: AdrenalineLevel | 'all';
}

/** Поле цены: только цифры, не длиннее 9 знаков. */
export const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);

/**
 * Строка для поиска по названию: без учёта регистра, «ё» и «е» — одна буква («звездный» находит «Звёздный старт»):
 * у букв снимаются две точки (U+0308 после разложения NFD; так же ü → u), остальное собирается обратно (й остаётся й).
 */
const fold = (s: string) =>
  s
    .toLocaleLowerCase('ru')
    .normalize('NFD')
    .replace(/\u0308/g, '')
    .normalize('NFC');

/** Витрина: бесплатные (бонусные) кейсы не показываются — их открывают из баннера и бонусов; пустые категории выпадают. */
export function showcaseCategories(categories: CaseCategoryDto[]): CaseCategoryDto[] {
  return categories
    .map((c) => ({ ...c, cases: c.cases.filter((k) => k.kind !== 'free') }))
    .filter((c) => c.cases.length > 0);
}

/**
 * Категории с кейсами, прошедшими фильтры: название — без учёта регистра, крайних пробелов и разницы «ё» / «е»,
 * цена «от» и «до» — в любом порядке, уровень адреналина; категории без кейсов выпадают.
 */
export function filterCategories(categories: CaseCategoryDto[], f: CaseFilters): CaseCategoryDto[] {
  const q = fold(f.query.trim());
  const lo = f.min === '' ? 0 : Number(f.min);
  const hi = f.max === '' ? Number.POSITIVE_INFINITY : Number(f.max);
  return categories
    .filter((c) => f.category === 'all' || c.code === f.category)
    .map((c) => ({
      ...c,
      cases: c.cases.filter(
        (k) =>
          (!q || fold(k.name).includes(q)) &&
          k.price >= Math.min(lo, hi) &&
          k.price <= Math.max(lo, hi) &&
          (f.level === 'all' || k.adrenaline === f.level),
      ),
    }))
    .filter((c) => c.cases.length > 0);
}

/** Заданы ли фильтры, которые на телефоне живут в панели «Расширенные фильтры»: цена «от» > 0, «до» < максимума, уровень. */
export function extraFiltersActive(
  f: Pick<CaseFilters, 'min' | 'max' | 'level'>,
  maxPrice: number,
): boolean {
  return (
    (f.min !== '' && Number(f.min) > 0) ||
    (f.max !== '' && Number(f.max) < maxPrice) ||
    f.level !== 'all'
  );
}
