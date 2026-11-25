import { describe, expect, it } from 'vitest';
import { KNIFE_RARITY_COLOR, displayRarityColor } from './catalog.js';

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
