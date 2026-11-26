import type { CaseCardDto, CaseCategoryDto } from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import { caseNeighbours, formatChance } from './case-page';

function card(slug: string, kind: CaseCardDto['kind'] = 'paid'): CaseCardDto {
  return {
    id: slug,
    slug,
    name: slug.toUpperCase(),
    imageUrl: `/media/cases/${slug}.webp`,
    accentColor: '#ffffff',
    price: kind === 'free' ? 0 : 10,
    kind,
    minLevel: null,
    cooldownSeconds: null,
    supplyTotal: null,
    supplyUsed: 0,
    categoryCode: 'c',
    adrenaline: 'low',
  };
}

const CATEGORIES: CaseCategoryDto[] = [
  { code: 'a', name: 'A', cases: [card('a1'), card('a2'), card('a3')] },
  { code: 'b', name: 'B', cases: [card('b1'), card('b2')] },
  { code: 'free', name: 'Free', cases: [card('daily', 'free')] },
];

describe('caseNeighbours', () => {
  it('follows the home catalogue order across categories', () => {
    const n = caseNeighbours(CATEGORIES, 'a3');
    expect(n?.prev.slug).toBe('a2');
    expect(n?.next.slug).toBe('b1');
  });

  it('wraps around at both ends', () => {
    expect(caseNeighbours(CATEGORIES, 'a1')?.prev.slug).toBe('b2');
    expect(caseNeighbours(CATEGORIES, 'b2')?.next.slug).toBe('a1');
  });

  it('skips free cases and has no neighbours for cases outside the list', () => {
    expect(caseNeighbours(CATEGORIES, 'b2')?.next.slug).not.toBe('daily');
    expect(caseNeighbours(CATEGORIES, 'daily')).toBeNull();
    expect(caseNeighbours(CATEGORIES, 'missing')).toBeNull();
  });

  it('needs at least two cases', () => {
    expect(caseNeighbours([{ code: 'a', name: 'A', cases: [card('solo')] }], 'solo')).toBeNull();
  });
});

describe('formatChance', () => {
  it('shows two decimals with a dot, like the mockup', () => {
    expect(formatChance('0.58')).toBe('0.58');
    expect(formatChance('2.7861')).toBe('2.79');
    expect(formatChance('32.5134')).toBe('32.51');
    expect(formatChance(100)).toBe('100.00');
  });

  it('keeps two significant digits for tiny chances', () => {
    expect(formatChance('0.00412')).toBe('0.0041');
    expect(formatChance('0.00001')).toBe('0.00001');
    expect(formatChance('0.00999')).toBe('0.01');
  });

  it('never prints garbage', () => {
    expect(formatChance('')).toBe('0');
    expect(formatChance('abc')).toBe('0');
  });
});
