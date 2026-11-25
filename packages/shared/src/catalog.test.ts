import { describe, expect, it } from 'vitest';
import { KNIFE_RARITY_COLOR, displayRarityColor } from './catalog.js';
import { caseAdrenaline } from './cases.js';

describe('displayRarityColor', () => {
  it('paints every knife gold regardless of rarity', () => {
    expect(displayRarityColor('knife', '#DC2A2A')).toBe(KNIFE_RARITY_COLOR);
    expect(displayRarityColor('knife', '#6D8588')).toBe('#DCBB2A');
  });

  it('keeps the rarity color for other items', () => {
    expect(displayRarityColor('weapon', '#742ADC')).toBe('#742ADC');
    expect(displayRarityColor('gloves', '#DCBB2A')).toBe('#DCBB2A');
  });
});

describe('caseAdrenaline', () => {
  it('rates steady cases low and jackpot cases extreme', () => {
    const steady = [
      { price: 90, odds: 50 },
      { price: 110, odds: 50 },
    ];
    expect(caseAdrenaline(steady, 100)).toBe('low');
    const jackpot = [
      { price: 10, odds: 990 },
      { price: 10_000, odds: 10 },
    ];
    expect(caseAdrenaline(jackpot, 100)).toBe('extreme');
  });

  it('uses the expected value as the reference for free cases', () => {
    expect(caseAdrenaline([{ price: 5, odds: 1 }], 0)).toBe('low');
    expect(caseAdrenaline([], 100)).toBe('normal');
  });
});
