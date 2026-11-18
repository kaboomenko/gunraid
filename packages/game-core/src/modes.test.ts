import { describe, expect, it } from 'vitest';
import {
  contractGamma,
  contractMultiplier,
  contractRange,
  contractWinProbability,
  pickNearestByPrice,
} from './contract.js';
import { rollFloat } from './fair.js';
import {
  CHANCE_SCALE,
  chanceToScaled,
  rollToScaled,
  upgradeChance,
  upgradeWins,
} from './upgrade.js';

const UP = { commission: 0.1, maxChance: 0.75, minChance: 0.01 };
const CT = { commission: 0.1, coefMin: 0.25, coefMax: 4 };

describe('upgrade', () => {
  it('computes the chance with commission and cap', () => {
    expect(upgradeChance(100, 200, UP)).toBeCloseTo(0.45, 10);
    expect(upgradeChance(100, 101, UP)).toBe(0.75);
    expect(upgradeChance(0, 200, UP)).toBe(0);
  });

  it('pays out 1 − commission on average when the cap does not bind', () => {
    const chance = chanceToScaled(upgradeChance(100, 300, UP));
    let won = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++)
      if (upgradeWins(rollToScaled(rollFloat('s', 'c', i)), chance)) won++;
    const rtp = ((won / N) * 300) / 100;
    expect(rtp).toBeCloseTo(0.9, 1);
    expect(chance).toBeLessThan(CHANCE_SCALE);
  });
});

describe('contract', () => {
  it('derives gamma so that the expected multiplier equals 1 − commission', () => {
    const g = contractGamma(CT);
    expect(g).toBeCloseTo(4.769, 2);
    expect(CT.coefMin + (CT.coefMax - CT.coefMin) / (g + 1)).toBeCloseTo(0.9, 10);
    expect(contractWinProbability(CT)).toBeCloseTo(0.286, 2);
  });

  it('keeps multipliers in range and averages ≈ 0.9 over many rolls', () => {
    const g = contractGamma(CT);
    let sum = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const k = contractMultiplier(rollFloat('srv', 'cli', i), CT, g);
      expect(k).toBeGreaterThanOrEqual(0.25);
      expect(k).toBeLessThan(4);
      sum += k;
    }
    expect(sum / N).toBeCloseTo(0.9, 1);
  });

  it('computes the visible range and picks the nearest item', () => {
    expect(contractRange(1000, CT)).toEqual({ min: 250, max: 4000 });
    const pool = [
      { id: 'a', price: 100 },
      { id: 'b', price: 300 },
      { id: 'c', price: 500 },
    ];
    expect(pickNearestByPrice(pool, 380)?.id).toBe('b');
    expect(pickNearestByPrice(pool, 400)?.id).toBe('b');
    expect(pickNearestByPrice([], 1)).toBeNull();
  });
});
