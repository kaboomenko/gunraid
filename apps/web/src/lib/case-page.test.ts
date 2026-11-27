import type { CaseCardDto, CaseCategoryDto, CaseContentItemDto, ItemDto } from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import {
  IDLE_INDEX,
  IDLE_LENGTH,
  STRIP_LENGTH,
  WIN_INDEX,
  buildStrip,
  caseNeighbours,
  formatChance,
  laneSeed,
  reelOffset,
  STRIP_MAX_SHARED,
  stripSeed,
  stripSeeds,
} from './case-page';

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

function item(id: string): ItemDto {
  return {
    id,
    fullName: `Knife | ${id}`,
    skinName: id,
    modelName: 'Knife',
    typeCode: 'knife',
    rarity: { code: 'covert', name: 'Covert', color: '#DC2A2A', sortOrder: 6 },
    imageUrl: null,
    price: 100,
    isStattrak: false,
    isSouvenir: false,
    wear: null,
    floatMin: null,
    floatMax: null,
    isWithdrawable: true,
  };
}

const POOL: CaseContentItemDto[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
  item: item(id),
  odds: (i + 1) * 100,
  chance: String((i + 1) * 6.67),
}));

describe('reelOffset', () => {
  it('puts the centre of card i under the marker', () => {
    const phone = { card: 90, pitch: 93, view: 360 };
    // Витрина дропленты — тот же сдвиг, что в CSS: 50cqw − (5 · 93 + 45) при окне 360.
    expect(reelOffset(IDLE_INDEX, phone)).toBe(180 - (5 * 93 + 45));
    expect(reelOffset(WIN_INDEX, phone)).toBe(-4143);
    expect(reelOffset(WIN_INDEX, { card: 286, pitch: 298, view: 1920 })).toBe(
      960 - (46 * 298 + 143),
    );
  });

  it('moves vertical lanes down', () => {
    expect(reelOffset(WIN_INDEX, { card: 185, pitch: 197, view: 286 }, 'y')).toBe(
      46 * 197 + 92.5 - 143,
    );
  });
});

describe('laneSeed', () => {
  it('keeps the seeds of the scene roulette', () => {
    expect(laneSeed(1, 0)).toBe(9301 + 49297);
    expect(laneSeed(7, 3)).toBe(7 * 9301 + 49297 + 3 * 7919);
  });
});

describe('stripSeed', () => {
  it('is a deterministic 32-bit seed, distinct per spin and lane', () => {
    expect(stripSeed(3, 2)).toBe(stripSeed(3, 2));
    const seeds = new Set<number>();
    for (let spin = 0; spin < 200; spin++)
      for (let lane = 0; lane < 5; lane++) {
        const s = stripSeed(spin, lane);
        expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
        seeds.add(s);
      }
    expect(seeds.size).toBe(1000);
  });

  /** Доли совпадений карточек соседних лент витрины x5 по позициям 0…IDLE_LENGTH − 1 (spinId 1…200). */
  const adjacentMatches = (seed: (spin: number, lane: number) => number) => {
    const same = new Array<number>(IDLE_LENGTH).fill(0);
    let pairs = 0;
    for (let spin = 1; spin <= 200; spin++) {
      const lanes = [0, 1, 2, 3, 4].map((lane) =>
        buildStrip(POOL, null, seed(spin, lane))
          .slice(0, IDLE_LENGTH)
          .map((e) => e.item.id),
      );
      for (let lane = 1; lane < lanes.length; lane++) {
        pairs++;
        lanes[lane]!.forEach((id, i) => {
          if (id === lanes[lane - 1]![i]) same[i]!++;
        });
      }
    }
    return same.map((n) => n / pairs);
  };

  it('gives adjacent strip lanes unrelated cards, like independent draws', () => {
    // Независимо: Σp² = 55/225 ≈ 0.24 на позицию (на 3-й и 10-й — 1/3), ≈ 2.9 общих из 11. Шаг laneSeed давал
    // сдвинутые копии: до 0.92 на позиции, 4.95 общих.
    const strip = adjacentMatches(stripSeed);
    expect(Math.max(...strip)).toBeLessThan(0.45);
    expect(strip.reduce((a, b) => a + b, 0)).toBeLessThan(3.4);
    expect(Math.max(...adjacentMatches(laneSeed))).toBeGreaterThan(0.8);
  });
});

describe('stripSeeds', () => {
  /** Кейс с одним частым предметом (75 %, он последний в составе): независимые ленты часто почти совпадают. */
  const SKEWED: CaseContentItemDto[] = [2, 3, 5, 15, 75].map((odds, i) => ({
    item: item(`s${i}`),
    odds,
    chance: String(odds),
  }));
  const showcase = (seed: number) =>
    buildStrip(SKEWED, null, seed)
      .slice(0, IDLE_LENGTH)
      .map((e) => e.item.id);

  it('never lets adjacent lanes copy each other, even with one frequent item', () => {
    let redrawn = 0;
    for (let spin = 1; spin <= 300; spin++) {
      const seeds = stripSeeds(SKEWED, spin, 5);
      expect(seeds).toHaveLength(5);
      expect(seeds[0]).toBe(stripSeed(spin, 0));
      for (let lane = 1; lane < 5; lane++) {
        const a = showcase(seeds[lane - 1]!);
        const b = showcase(seeds[lane]!);
        expect(b.filter((id, i) => id === a[i]).length).toBeLessThanOrEqual(STRIP_MAX_SHARED);
        if (seeds[lane] !== stripSeed(spin, lane)) redrawn++;
      }
    }
    // Запасная дорожка нужна редко — распределение карточек почти не меняется.
    expect(redrawn).toBeGreaterThan(0);
    expect(redrawn / (300 * 4)).toBeLessThan(0.3);
  });

  it('starts the spin with the showcase: a lane depends only on the lanes above it', () => {
    for (let spin = 1; spin <= 50; spin++) {
      const five = stripSeeds(SKEWED, spin, 5);
      for (let n = 1; n <= 5; n++) expect(stripSeeds(SKEWED, spin, n)).toEqual(five.slice(0, n));
    }
    expect(stripSeeds([], 1, 3)).toHaveLength(3);
  });
});

describe('buildStrip', () => {
  const winner = item('won');

  it('puts the server winner at WIN_INDEX', () => {
    const strip = buildStrip(POOL, winner, laneSeed(2, 0));
    expect(strip).toHaveLength(STRIP_LENGTH);
    expect(strip[WIN_INDEX]?.item).toBe(winner);
  });

  it('starts the spin with the idle showcase (nothing is swapped when the spin starts)', () => {
    for (let lane = 0; lane < 5; lane++) {
      const seed = stripSeed(3, lane);
      expect(buildStrip(POOL, winner, seed).slice(0, IDLE_LENGTH)).toEqual(
        buildStrip(POOL, null, seed).slice(0, IDLE_LENGTH),
      );
    }
    expect(IDLE_INDEX).toBeLessThan(IDLE_LENGTH);
    expect(IDLE_LENGTH).toBeLessThanOrEqual(WIN_INDEX);
  });

  it('is deterministic per seed and differs between lanes', () => {
    expect(buildStrip(POOL, null, 42)).toEqual(buildStrip(POOL, null, 42));
    expect(buildStrip(POOL, null, laneSeed(1, 0))).not.toEqual(
      buildStrip(POOL, null, laneSeed(1, 1)),
    );
  });

  it('gives an empty strip for an empty pool', () => {
    expect(buildStrip([], winner, 1)).toEqual([]);
  });
});
