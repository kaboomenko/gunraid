import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  battleClientSeed,
  cargoClientSeed,
  cargoClientSeedPreimage,
  cargoSeatOwner,
  cargoSeatsSold,
  cargoWinningSeat,
  rollFloat,
  sha256Hex,
  type CargoSeatRange,
} from './index.js';

const SERVER = 'e1b5d6c3f0a94b8d9a7c6e5f4d3c2b1a0918273645546372819a0b1c2d3e4f50';
const range = (seatFrom: number, seatTo: number, clientSeed: string): CargoSeatRange => ({
  seatFrom,
  seatTo,
  clientSeed,
});

describe('cargo', () => {
  it('fixed vector: preimage, client seed, float, seat and owner (cross-checked with node:crypto)', () => {
    const purchases = [range(1, 3, 'aaaaaaaa'), range(4, 4, 'bbbbbbbb'), range(5, 10, 'cccccccc')];
    // Строка записана буквально, как в docs/architecture.md §5.2: проверку можно повторить любым языком.
    const literal = '[[1,3,"aaaaaaaa"],[4,4,"bbbbbbbb"],[5,10,"cccccccc"]]';
    expect(cargoClientSeedPreimage(purchases)).toBe(literal);

    const cs = cargoClientSeed(purchases);
    expect(cs).toBe('2b950d061c8c513d3e11ac3d0253a05dc29332f8e747546f8bd2f41ee231e13a');
    expect(cs).toBe(createHash('sha256').update(literal, 'utf8').digest('hex'));

    const float = rollFloat(SERVER, cs, 0);
    expect(float).toBe(0.24156344243204542);
    const hmac = createHmac('sha256', SERVER).update(`${cs}:0:0`).digest('hex');
    expect(float).toBe(parseInt(hmac.slice(0, 13), 16) / 2 ** 52);

    const sold = cargoSeatsSold(purchases);
    expect(sold).toBe(10);
    const seat = cargoWinningSeat(SERVER, cs, sold);
    expect(seat).toBe(3);
    expect(seat).toBe(Math.floor(float * sold) + 1);
    expect(cargoSeatOwner(purchases, seat)).toBe(purchases[0]);
  });

  it('different purchase lists never share a preimage (unlike the battle join with «:»)', () => {
    const a = [range(1, 1, 'a:b'), range(2, 2, 'c')];
    const b = [range(1, 1, 'a'), range(2, 2, 'b:c')];
    expect(cargoClientSeedPreimage(a)).not.toBe(cargoClientSeedPreimage(b));
    expect(cargoClientSeed(a)).not.toBe(cargoClientSeed(b));
    // Склейка через «:» у баттлов этих случаев не различает — поэтому у груза JSON.
    expect(battleClientSeed(['a:b', 'c'])).toBe(battleClientSeed(['a', 'b:c']));
    // Те же места, но другая разбивка на покупки — тоже другой client seed.
    expect(cargoClientSeed([range(1, 2, 'aaaaaaaa')])).not.toBe(
      cargoClientSeed([range(1, 1, 'aaaaaaaa'), range(2, 2, 'aaaaaaaa')]),
    );
  });

  it('the seat is always in [1, sold], deterministic, and depends on the server seed', () => {
    const otherServer = sha256Hex('other-server-seed');
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const sold = (i % 25) + 1;
      const cs = cargoClientSeed([range(1, sold, `seed-${String(i).padStart(4, '0')}`)]);
      const seat = cargoWinningSeat(SERVER, cs, sold);
      expect(Number.isInteger(seat)).toBe(true);
      expect(seat).toBeGreaterThanOrEqual(1);
      expect(seat).toBeLessThanOrEqual(sold);
      expect(cargoWinningSeat(SERVER, cs, sold)).toBe(seat);
      if (cargoWinningSeat(otherServer, cs, sold) !== seat) differs++;
    }
    expect(differs).toBeGreaterThan(100);
    expect(cargoWinningSeat(SERVER, cargoClientSeed([range(1, 1, 'aaaaaaaa')]), 1)).toBe(1);
  });

  it('is uniform: 20 000 server seeds, 4 seats sold → each seat 25 % ± 2 %', () => {
    const cs = cargoClientSeed([range(1, 2, 'uniform1'), range(3, 4, 'uniform2')]);
    const hits = [0, 0, 0, 0];
    const runs = 20_000;
    // Псевдослучайные, но воспроизводимые server seed'ы: при падении результат можно повторить.
    for (let i = 0; i < runs; i++) {
      const seat = cargoWinningSeat(sha256Hex(`cargo-uniformity:${i}`), cs, 4);
      hits[seat - 1] = (hits[seat - 1] ?? 0) + 1;
    }
    for (const h of hits) expect(Math.abs(h / runs - 0.25)).toBeLessThan(0.02);
  });

  it('finds the owner of a seat on range boundaries and rejects seats outside', () => {
    const purchases = [range(1, 3, 'aaaaaaaa'), range(4, 4, 'bbbbbbbb'), range(5, 10, 'cccccccc')];
    const owner = (seat: number) => purchases.indexOf(cargoSeatOwner(purchases, seat));
    expect([1, 2, 3, 4, 5, 9, 10].map(owner)).toEqual([0, 0, 0, 1, 2, 2, 2]);
    expect(() => cargoSeatOwner(purchases, 0)).toThrow(RangeError);
    expect(() => cargoSeatOwner(purchases, 11)).toThrow(RangeError);
    expect(() => cargoSeatOwner([], 1)).toThrow(RangeError);
    // Одна покупка на все места и много покупок по одному месту.
    expect(cargoSeatOwner([range(1, 500, 'aaaaaaaa')], 500).seatTo).toBe(500);
    const singles = Array.from({ length: 1000 }, (_, i) => range(i + 1, i + 1, 'aaaaaaaa'));
    expect(cargoSeatOwner(singles, 777).seatFrom).toBe(777);
  });

  it('counts sold seats only for contiguous ranges starting at 1', () => {
    expect(cargoSeatsSold([])).toBe(0);
    expect(cargoSeatsSold([range(1, 1, 'aaaaaaaa')])).toBe(1);
    expect(cargoSeatsSold([range(1, 3, 'aaaaaaaa'), range(4, 9, 'bbbbbbbb')])).toBe(9);
    // Пропуск, наложение, старт не с 1, перевёрнутый диапазон.
    expect(() => cargoSeatsSold([range(1, 2, 'aaaaaaaa'), range(4, 5, 'bbbbbbbb')])).toThrow(
      RangeError,
    );
    expect(() => cargoSeatsSold([range(1, 3, 'aaaaaaaa'), range(3, 5, 'bbbbbbbb')])).toThrow(
      RangeError,
    );
    expect(() => cargoSeatsSold([range(2, 3, 'aaaaaaaa')])).toThrow(RangeError);
    expect(() => cargoSeatsSold([range(1, 0, 'aaaaaaaa')])).toThrow(RangeError);
  });

  it('refuses to draw without sold seats', () => {
    const cs = cargoClientSeed([]);
    expect(() => cargoWinningSeat(SERVER, cs, 0)).toThrow(RangeError);
    expect(() => cargoWinningSeat(SERVER, cs, -1)).toThrow(RangeError);
    expect(() => cargoWinningSeat(SERVER, cs, 1.5)).toThrow(RangeError);
    expect(() => cargoWinningSeat(SERVER, cs, Number.NaN)).toThrow(RangeError);
  });
});
