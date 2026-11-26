import {
  CARGO_SEED_RE,
  type CargoCardDto,
  type CargoDetailDto,
  type CargoSeatsEventDto,
  type ItemDto,
} from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import {
  cargoChance,
  cargoImageSrcSet,
  cargoNeighbours,
  clampCount,
  formatSeatRanges,
  mergeSeats,
  randomClientSeed,
  splitCountdown,
} from './cargo-page';
import { formatChance } from './case-page';

const PRIZE: ItemDto = {
  id: 'item-1',
  fullName: 'M9 Bayonet "Dragon Glass"',
  skinName: 'Dragon Glass',
  modelName: 'M9 Bayonet',
  typeCode: 'knife',
  rarity: { code: 'arcane', name: 'Аркана', color: '#DCBB2A', sortOrder: 6 },
  imageUrl: '/media/skins/so2/m9-bayonet-dragon-glass.webp',
  price: 13700,
  isStattrak: false,
  isSouvenir: false,
  wear: null,
  floatMin: null,
  floatMax: null,
  isWithdrawable: true,
};

function card(slug: string): CargoCardDto {
  return {
    id: `t-${slug}`,
    slug,
    name: slug.toUpperCase(),
    imageUrl: `/media/cargo/${slug}.webp`,
    isFree: false,
    roundId: `r-${slug}`,
    seatsTotal: 100,
    seatsSold: 0,
    seatPrice: 153,
    endsAt: '2026-11-27T12:00:00.000Z',
    prize: PRIZE,
  };
}

function detail(seatsSold: number, maxBuy: number): CargoDetailDto {
  return {
    id: 't-light',
    slug: 'light',
    name: 'Лёгкий груз',
    imageUrl: '/media/cargo/light.webp',
    isFree: false,
    round: {
      id: 'round-1',
      number: 1,
      status: 'open',
      seatsTotal: 100,
      seatsSold,
      seatPrice: 153,
      perUserLimit: null,
      minLevel: null,
      depositWithinDays: null,
      minSeatsToLand: null,
      prize: PRIZE,
      serverSeedHash: 'a'.repeat(64),
      startedAt: '2026-11-26T12:00:00.000Z',
      endsAt: '2026-11-27T12:00:00.000Z',
    },
    noRound: null,
    availability: { canBuy: true, reason: null, mySeats: 0, myPurchases: [], maxBuy },
    lastResult: null,
    serverTime: '2026-11-26T13:00:00.000Z',
  };
}

function seats(seatsSold: number, roundId = 'round-1'): CargoSeatsEventDto {
  return { game: 'standoff2', templateId: 't-light', roundId, seatsSold, seatsTotal: 100 };
}

describe('cargoNeighbours', () => {
  const LIST = ['light', 'black', 'free', 'signal', 'special'].map(card);

  it('follows the list order and wraps around', () => {
    expect(cargoNeighbours(LIST, 'free')).toEqual({
      prev: { slug: 'black', name: 'BLACK', imageUrl: '/media/cargo/black.webp' },
      next: { slug: 'signal', name: 'SIGNAL', imageUrl: '/media/cargo/signal.webp' },
    });
    expect(cargoNeighbours(LIST, 'light')?.prev.slug).toBe('special');
    expect(cargoNeighbours(LIST, 'special')?.next.slug).toBe('light');
  });

  it('has no neighbours for a single cargo or one missing from the list', () => {
    expect(cargoNeighbours([card('light')], 'light')).toBeNull();
    expect(cargoNeighbours(LIST, 'unknown')).toBeNull();
    expect(cargoNeighbours([], 'light')).toBeNull();
  });
});

describe('cargoChance', () => {
  it('is (mine + count) / total in percent', () => {
    expect(formatChance(cargoChance(0, 1, 100))).toBe('1.00');
    expect(formatChance(cargoChance(3, 4, 200))).toBe('3.50');
    expect(formatChance(cargoChance(0, 1, 10_000))).toBe('0.01');
  });

  it('caps at 100 and is 0 without seats', () => {
    expect(cargoChance(60, 50, 100)).toBe('100');
    expect(cargoChance(1, 1, 0)).toBe('0');
    expect(formatChance(cargoChance(0, 0, 100))).toBe('0');
  });
});

describe('splitCountdown', () => {
  it('pads every field to two digits', () => {
    expect(splitCountdown(0)).toEqual({ hours: '00', minutes: '00', seconds: '00' });
    expect(splitCountdown((23 * 3600 + 52 * 60 + 15) * 1000)).toEqual({
      hours: '23',
      minutes: '52',
      seconds: '15',
    });
  });

  it('rounds seconds up and never goes negative', () => {
    expect(splitCountdown(59_400)).toEqual({ hours: '00', minutes: '01', seconds: '00' });
    expect(splitCountdown(1)).toEqual({ hours: '00', minutes: '00', seconds: '01' });
    expect(splitCountdown(-5_000)).toEqual({ hours: '00', minutes: '00', seconds: '00' });
    expect(splitCountdown(Number.NaN)).toEqual({ hours: '00', minutes: '00', seconds: '00' });
  });

  it('keeps whole hours above 24 and 99', () => {
    expect(splitCountdown(90_061_000)).toEqual({ hours: '25', minutes: '01', seconds: '01' });
    expect(splitCountdown(360_000_000)).toEqual({ hours: '100', minutes: '00', seconds: '00' });
  });
});

describe('clampCount', () => {
  it('keeps the count within 1…max', () => {
    expect(clampCount(50, 100)).toBe(50);
    expect(clampCount(150, 100)).toBe(100);
    expect(clampCount(0, 100)).toBe(1);
    expect(clampCount(-3, 100)).toBe(1);
    expect(clampCount(2.7, 100)).toBe(2);
  });

  it('falls back to 1 when nothing can be bought or the input is not a number', () => {
    expect(clampCount(5, 0)).toBe(1);
    expect(clampCount(5, -1)).toBe(1);
    expect(clampCount(Number.NaN, 10)).toBe(1);
  });
});

describe('randomClientSeed', () => {
  it('matches the client seed format and differs between calls', () => {
    const a = randomClientSeed();
    const b = randomClientSeed();
    expect(a).toMatch(CARGO_SEED_RE);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('mergeSeats', () => {
  it('raises seatsSold and trims maxBuy to the free seats', () => {
    const d = mergeSeats(detail(90, 10), seats(95));
    expect(d.round?.seatsSold).toBe(95);
    expect(d.availability.maxBuy).toBe(5);
    expect(d.availability.canBuy).toBe(true);
    expect(d.availability.reason).toBeNull();
  });

  it('never lowers seatsSold (events may arrive out of order)', () => {
    const d = detail(40, 60);
    expect(mergeSeats(d, seats(30))).toBe(d);
    expect(mergeSeats(d, seats(40))).toBe(d);
  });

  it('ignores another round', () => {
    const d = detail(40, 60);
    expect(mergeSeats(d, seats(99, 'round-2'))).toBe(d);
    const none = { ...d, round: null };
    expect(mergeSeats(none, seats(99))).toBe(none);
  });

  it('blocks buying when the round is sold out', () => {
    const d = mergeSeats(detail(97, 3), seats(100));
    expect(d.round?.seatsSold).toBe(100);
    expect(d.availability).toMatchObject({ maxBuy: 0, canBuy: false, reason: 'SOLD_OUT' });
  });
});

describe('formatSeatRanges', () => {
  const p = (seatFrom: number, seatTo: number) => ({ seatFrom, seatTo, clientSeed: 'a'.repeat(8) });

  it('glues adjacent purchases and shows single seats as one number', () => {
    expect(formatSeatRanges([p(3, 4), p(1, 2)])).toEqual({ text: '№1–4', more: 0 });
    expect(formatSeatRanges([p(7, 7)])).toEqual({ text: '№7', more: 0 });
    expect(formatSeatRanges([p(1, 3), p(7, 7)])).toEqual({ text: '№1–3, №7', more: 0 });
  });

  it('counts the ranges that did not fit', () => {
    const list = [p(1, 1), p(3, 3), p(5, 6), p(9, 9), p(12, 20)];
    expect(formatSeatRanges(list)).toEqual({ text: '№1, №3, №5–6', more: 2 });
    expect(formatSeatRanges(list, 1)).toEqual({ text: '№1', more: 4 });
    expect(formatSeatRanges([])).toEqual({ text: '', more: 0 });
  });
});

describe('cargoImageSrcSet', () => {
  it('offers 500 and 1000 px copies of a standard cargo image', () => {
    expect(cargoImageSrcSet('/media/cargo/light.webp')).toBe(
      '/media/cargo/light-500.webp 500w, /media/cargo/light.webp 1000w',
    );
  });

  it('has no candidates for a custom image', () => {
    expect(cargoImageSrcSet('/media/cases/custom.webp')).toBeUndefined();
    expect(cargoImageSrcSet('https://cdn.example.com/cargo.webp')).toBeUndefined();
    expect(cargoImageSrcSet('/media/cargo/unknown.webp')).toBeUndefined();
  });
});
