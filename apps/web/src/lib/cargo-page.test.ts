import {
  CARGO_SEED_RE,
  type CargoBuyResultDto,
  type CargoCardDto,
  type CargoDetailDto,
  type CargoResultDto,
  type CargoSeatsEventDto,
  type ItemDto,
} from '@gunraid/shared';
import { describe, expect, it } from 'vitest';
import {
  cargoChance,
  cargoImageSrcSet,
  cargoNeighbours,
  cargoParticipant,
  cargoWide,
  clampCount,
  formatSeatRanges,
  mergeBuyResult,
  mergeSeats,
  missedResult,
  randomClientSeed,
  seatsKey,
  splitCountdown,
  stepCount,
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
    lastResultMySeats: 0,
    serverTime: '2026-11-26T13:00:00.000Z',
  };
}

function seats(seatsSold: number, roundId = 'round-1'): CargoSeatsEventDto {
  return { game: 'standoff2', templateId: 't-light', roundId, seatsSold, seatsTotal: 100 };
}

/** Ответ покупки одного места №seat: раунд и доступность — на момент своей транзакции. */
function bought(seat: number, maxBuy: number, roundId = 'round-1'): CargoBuyResultDto {
  const round = { ...detail(seat, maxBuy).round!, id: roundId };
  const purchase = { seatFrom: seat, seatTo: seat, clientSeed: 'c'.repeat(32) };
  return {
    purchaseId: 'p-1',
    templateId: 't-light',
    slug: 'light',
    roundId,
    seatFrom: seat,
    seatTo: seat,
    count: 1,
    paid: 153,
    clientSeed: purchase.clientSeed,
    serverSeedHash: round.serverSeedHash,
    balance: 1000,
    round,
    availability: {
      canBuy: maxBuy > 0,
      reason: maxBuy > 0 ? null : 'SOLD_OUT',
      mySeats: 1,
      myPurchases: [purchase],
      maxBuy,
    },
    result: null,
    next: null,
  };
}

function result(roundId: string): CargoResultDto {
  return {
    roundId,
    templateId: 't-light',
    number: 1,
    status: 'landed',
    landReason: 'sold_out',
    seatsSold: 100,
    seatsTotal: 100,
    minSeatsToLand: null,
    winningSeat: 57,
    winner: { shortId: 7, nickname: 'winner', avatarUrl: null },
    refunded: false,
    prize: PRIZE,
    finishedAt: '2026-11-26T13:00:00.000Z',
  };
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

describe('stepCount', () => {
  it('steps from the typed number, not from the previous one', () => {
    expect(stepCount('5', 1, 1, 100)).toBe(6);
    expect(stepCount('40', 1, -1, 100)).toBe(39);
    expect(stepCount('12', 1, 1, 100)).toBe(13);
  });

  it('steps from the chosen count when nothing is typed', () => {
    expect(stepCount(null, 3, 1, 100)).toBe(4);
    expect(stepCount(null, 3, -1, 100)).toBe(2);
    expect(stepCount('', 3, -1, 100)).toBe(2);
  });

  it('stays within 1…max', () => {
    expect(stepCount('500', 1, 1, 100)).toBe(100);
    expect(stepCount('500', 1, -1, 100)).toBe(99);
    expect(stepCount('0', 5, -1, 100)).toBe(1);
    expect(stepCount(null, 100, 1, 100)).toBe(100);
    expect(stepCount(null, 1, -1, 100)).toBe(1);
    expect(stepCount('7', 1, 1, 0)).toBe(1);
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

describe('mergeBuyResult', () => {
  it('takes the round and the availability from the response', () => {
    const d = mergeBuyResult(detail(0, 100), bought(1, 99));
    expect(d.round?.seatsSold).toBe(1);
    expect(d.availability).toMatchObject({ mySeats: 1, maxBuy: 99, canBuy: true, reason: null });
  });

  it('keeps purchases the socket brought while the response was on its way', () => {
    // Ответ посчитан до чужой покупки 97 мест: свободных 2, а не 99.
    const d = mergeBuyResult(detail(98, 2), bought(1, 99));
    expect(d.round?.seatsSold).toBe(98);
    expect(d.availability).toMatchObject({ mySeats: 1, maxBuy: 2, canBuy: true, reason: null });
  });

  it('blocks buying when others sold the rest meanwhile', () => {
    const d = mergeBuyResult(detail(100, 0), bought(1, 99));
    expect(d.round?.seatsSold).toBe(100);
    expect(d.availability).toMatchObject({ mySeats: 1, maxBuy: 0, canBuy: false });
    expect(d.availability.reason).toBe('SOLD_OUT');
  });

  it('ignores a response for a round that is no longer shown', () => {
    const d = detail(0, 100);
    expect(mergeBuyResult(d, bought(1, 99, 'round-0'))).toBe(d);
    const none = { ...d, round: null };
    expect(mergeBuyResult(none, bought(1, 99))).toBe(none);
  });
});

describe('missedResult', () => {
  const last = result('round-1');

  it('returns the result of a round the page showed, when it was not shown yet', () => {
    expect(missedResult(last, new Set(['round-1', 'round-2']), new Set())).toBe(last);
  });

  it('skips a round that finished before the page was opened', () => {
    expect(missedResult(last, new Set(['round-2']), new Set())).toBeNull();
  });

  it('skips a result that is already shown or missing', () => {
    expect(missedResult(last, new Set(['round-1']), new Set(['round-1']))).toBeNull();
    expect(missedResult(null, new Set(['round-1']), new Set())).toBeNull();
  });
});

describe('seatsKey', () => {
  it('keeps seats of different players in one round apart', () => {
    expect(seatsKey('user-a', 'round-1')).not.toBe(seatsKey('user-b', 'round-1'));
    expect(seatsKey('user-a', 'round-1')).not.toBe(seatsKey('user-a', 'round-2'));
    expect(seatsKey('user-a', 'round-1')).toBe(seatsKey('user-a', 'round-1'));
  });

  it('does not hand the seats of a player who logged out to the next one', () => {
    const seats = new Map([[seatsKey('user-a', 'round-1'), 2]]);
    expect(seats.get(seatsKey('user-b', 'round-1')) ?? 0).toBe(0);
  });
});

describe('cargoParticipant', () => {
  const r = result('round-1');
  const lost = { ...r, winner: { shortId: 8, nickname: 'other', avatarUrl: null } };
  const server = (roundId: string, lastResultMySeats: number) => ({
    lastResult: result(roundId),
    lastResultMySeats,
  });

  it('decides at once for a guest, the winner and seats the page knows', () => {
    expect(cargoParticipant(r, null, 0, null)).toBe(false);
    // Гость после выхода игрока с местами — не участник, что бы ни было в данных.
    expect(cargoParticipant(r, null, 3, server('round-1', 3))).toBe(false);
    expect(cargoParticipant(r, 7, 0, null)).toBe(true);
    expect(cargoParticipant(lost, 7, 2, null)).toBe(true);
  });

  it('is not a participant when no seats were sold at all', () => {
    const empty: CargoResultDto = {
      ...r,
      status: 'expired',
      landReason: 'deadline',
      seatsSold: 0,
      winningSeat: null,
      winner: null,
    };
    expect(cargoParticipant(empty, 7, 0, null)).toBe(false);
  });

  it('takes the seats bought in another tab from the server data of that round', () => {
    expect(cargoParticipant(lost, 7, 0, server('round-1', 2))).toBe(true);
    expect(cargoParticipant(lost, 7, 0, server('round-1', 0))).toBe(false);
  });

  it('needs fresh server data when it is about another round or missing', () => {
    // Данные груза ещё до приземления: lastResult — прошлый раунд.
    expect(cargoParticipant(lost, 7, 0, server('round-0', 5))).toBeNull();
    expect(cargoParticipant(lost, 7, 0, { lastResult: null, lastResultMySeats: 0 })).toBeNull();
    expect(cargoParticipant(lost, 7, 0, null)).toBeNull();
    expect(cargoParticipant(lost, 7, 0, undefined)).toBeNull();
  });
});

describe('cargoWide', () => {
  it('marks the special cargo with three canopies only', () => {
    expect(cargoWide('/media/cargo/special.webp')).toBe(true);
    for (const kind of ['light', 'black', 'free', 'signal'])
      expect(cargoWide(`/media/cargo/${kind}.webp`)).toBe(false);
    expect(cargoWide('/media/cases/custom.webp')).toBe(false);
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
