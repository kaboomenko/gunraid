import type { CaseCardDto, CaseCategoryDto } from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import {
  digits,
  extraFiltersActive,
  filterCategories,
  showcaseCategories,
  type CaseFilters,
} from './case-filters';

function card(
  slug: string,
  name: string,
  price: number,
  adrenaline: CaseCardDto['adrenaline'] = 'low',
  kind: CaseCardDto['kind'] = 'paid',
): CaseCardDto {
  return {
    id: slug,
    slug,
    name,
    imageUrl: `/media/cases/${slug}.webp`,
    accentColor: '#ffffff',
    price,
    kind,
    minLevel: null,
    cooldownSeconds: null,
    supplyTotal: null,
    supplyUsed: 0,
    categoryCode: 'c',
    adrenaline,
  };
}

const CATEGORIES: CaseCategoryDto[] = [
  {
    code: 'snowfall',
    name: 'Операция: “Снегопад”',
    cases: [card('star', 'Звёздный старт', 39), card('polar', 'Полярная удача', 69, 'normal')],
  },
  {
    code: 'safes',
    name: 'Редкостные сейфы',
    cases: [card('nameless', 'Nameless', 75999, 'extreme'), card('vault', 'Сейф', 500, 'high')],
  },
  { code: 'free', name: 'Бесплатные', cases: [card('daily', 'Ежедневный', 0, 'low', 'free')] },
];
const SHOW = showcaseCategories(CATEGORIES);
const ALL: CaseFilters = { category: 'all', query: '', min: '0', max: '75999', level: 'all' };
const slugs = (cats: CaseCategoryDto[]) => cats.flatMap((c) => c.cases.map((k) => k.slug));

describe('showcaseCategories', () => {
  it('drops free cases and categories left empty', () => {
    expect(SHOW.map((c) => c.code)).toEqual(['snowfall', 'safes']);
  });
});

describe('filterCategories', () => {
  it('keeps everything with default filters', () => {
    expect(slugs(filterCategories(SHOW, ALL))).toEqual(['star', 'polar', 'nameless', 'vault']);
  });
  it('searches names ignoring case and outer spaces', () => {
    expect(slugs(filterCategories(SHOW, { ...ALL, query: '  ЗВЁЗДНЫЙ ' }))).toEqual(['star']);
    expect(slugs(filterCategories(SHOW, { ...ALL, query: 'nAmE' }))).toEqual(['nameless']);
  });
  it('treats е and ё as one letter in both directions', () => {
    expect(slugs(filterCategories(SHOW, { ...ALL, query: 'звездный' }))).toEqual(['star']);
    expect(slugs(filterCategories(SHOW, { ...ALL, query: 'ЗВЕЗДНЫЙ' }))).toEqual(['star']);
    expect(slugs(filterCategories(SHOW, { ...ALL, query: 'сёйф' }))).toEqual(['vault']);
  });
  it('keeps й apart from и', () => {
    expect(filterCategories(SHOW, { ...ALL, query: 'звездныи' })).toEqual([]);
    expect(slugs(filterCategories(SHOW, { ...ALL, query: 'ный ст' }))).toEqual(['star']);
  });
  it('finds nothing for an unknown name', () => {
    expect(filterCategories(SHOW, { ...ALL, query: 'нет такого' })).toEqual([]);
  });
  it('swaps price bounds given in reverse order', () => {
    expect(slugs(filterCategories(SHOW, { ...ALL, min: '100', max: '50' }))).toEqual(['polar']);
  });
  it('treats an empty price field as no bound', () => {
    expect(slugs(filterCategories(SHOW, { ...ALL, min: '', max: '' }))).toHaveLength(4);
    expect(slugs(filterCategories(SHOW, { ...ALL, min: '70', max: '' }))).toEqual([
      'nameless',
      'vault',
    ]);
  });
  it('filters by category and level and drops empty categories', () => {
    expect(filterCategories(SHOW, { ...ALL, category: 'safes' }).map((c) => c.code)).toEqual([
      'safes',
    ]);
    const extreme = filterCategories(SHOW, { ...ALL, level: 'extreme' });
    expect(extreme.map((c) => c.code)).toEqual(['safes']);
    expect(slugs(extreme)).toEqual(['nameless']);
  });
  it('does not mutate the categories it filters', () => {
    filterCategories(SHOW, { ...ALL, level: 'extreme' });
    expect(slugs(SHOW)).toEqual(['star', 'polar', 'nameless', 'vault']);
  });
});

describe('extraFiltersActive', () => {
  const base = { min: '0', max: '75999', level: 'all' as const };
  it('is off with defaults, empty fields and a bound above the maximum', () => {
    expect(extraFiltersActive(base, 75999)).toBe(false);
    expect(extraFiltersActive({ ...base, min: '', max: '' }, 75999)).toBe(false);
    expect(extraFiltersActive({ ...base, max: '80000' }, 75999)).toBe(false);
  });
  it('is on when a price bound or a level is set', () => {
    expect(extraFiltersActive({ ...base, min: '1' }, 75999)).toBe(true);
    expect(extraFiltersActive({ ...base, max: '100' }, 75999)).toBe(true);
    expect(extraFiltersActive({ ...base, level: 'high' }, 75999)).toBe(true);
  });
});

describe('digits', () => {
  it('keeps at most nine digits', () => {
    expect(digits('1 2a3')).toBe('123');
    expect(digits('12345678901')).toBe('123456789');
  });
});
