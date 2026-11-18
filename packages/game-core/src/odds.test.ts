import { describe, expect, it } from 'vitest';
import { rollFloat } from './fair.js';
import {
  ODDS_TOTAL,
  caseRtp,
  fitOddsToRtp,
  oddsToPercent,
  percentToOdds,
  pickByTicket,
  ticketFromFloat,
  validateOdds,
} from './odds.js';

const entries = [
  { itemId: 'a', odds: 7_000_000 },
  { itemId: 'b', odds: 2_500_000 },
  { itemId: 'c', odds: 450_000 },
  { itemId: 'd', odds: 50_000 },
];

describe('odds', () => {
  it('validates that odds sum to exactly 100%', () => {
    expect(validateOdds(entries)).toEqual({ ok: true, sum: ODDS_TOTAL });
    expect(validateOdds([{ odds: 1 }]).ok).toBe(false);
    expect(validateOdds([{ odds: ODDS_TOTAL - 1 }, { odds: 0 }, { odds: 1 }]).ok).toBe(false);
  });

  it('maps tickets to cumulative ranges', () => {
    expect(pickByTicket(entries, 0).itemId).toBe('a');
    expect(pickByTicket(entries, 6_999_999).itemId).toBe('a');
    expect(pickByTicket(entries, 7_000_000).itemId).toBe('b');
    expect(pickByTicket(entries, ODDS_TOTAL - 1).itemId).toBe('d');
    expect(() => pickByTicket(entries, ODDS_TOTAL)).toThrow();
    expect(ticketFromFloat(0.999999999)).toBe(ODDS_TOTAL - 1);
  });

  it('converts between percent and odds', () => {
    expect(oddsToPercent(50_000)).toBe('0.5');
    expect(oddsToPercent(1)).toBe('0.00001');
    expect(percentToOdds('12,34567')).toBe(1_234_567);
  });

  it('produces the declared distribution over many fair rolls', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const it = pickByTicket(entries, ticketFromFloat(rollFloat('server-seed', 'client', i)));
      counts[it.itemId] = (counts[it.itemId] ?? 0) + 1;
    }
    expect(counts.a! / N).toBeCloseTo(0.7, 2);
    expect(counts.b! / N).toBeCloseTo(0.25, 2);
    expect(counts.c! / N).toBeCloseTo(0.045, 2);
    expect(counts.d! / N).toBeCloseTo(0.005, 2);
  });

  it('fits odds to a target RTP with an exact 100% sum', () => {
    const prices = [5, 12, 40, 90, 240, 600, 1500, 9800];
    const odds = fitOddsToRtp(prices, 150, 0.9);
    expect(odds.reduce((a, b) => a + b, 0)).toBe(ODDS_TOTAL);
    const rtp = caseRtp(
      prices.map((price, i) => ({ price, odds: odds[i] as number })),
      150,
    );
    expect(rtp).toBeCloseTo(0.9, 2);
    expect(caseRtp([{ price: 10, odds: ODDS_TOTAL }], 0)).toBeNull();
  });
});
