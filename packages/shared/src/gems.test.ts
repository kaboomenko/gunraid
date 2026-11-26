import { describe, expect, it } from 'vitest';
import { formatDecimal, formatGems, parseDecimal, quoteGems, usdToGemsRounded } from './gems.js';

describe('gems', () => {
  it('formats with ru-RU grouping and no fractions', () => {
    expect(formatGems(1234567).replace(/\s/g, ' ')).toBe('1 234 567');
    expect(formatGems(5)).toBe('5');
  });

  it('keeps four-digit numbers whole, as in the mockups', () => {
    expect(formatGems(1450)).toBe('1450');
    expect(formatGems(15999).replace(/\s/g, ' ')).toBe('15 999');
    expect(formatGems(293200).replace(/\s/g, ' ')).toBe('293 200');
  });

  it('parses and formats decimals exactly', () => {
    expect(formatDecimal(parseDecimal('0.000123'))).toBe('0.000123');
    expect(formatDecimal(parseDecimal('100'))).toBe('100');
    expect(() => parseDecimal('1e5')).toThrow();
    expect(() => parseDecimal('-1')).toThrow();
  });

  it('quotes gems by rounding down', () => {
    // $1 = 100 гемов
    expect(quoteGems('1', '1', 100)).toBe(100);
    expect(quoteGems('12.34', '1', 100)).toBe(1234);
    // 1000 RUB по курсу 0.0123 USD → 12.3 USD → 1230 гемов
    expect(quoteGems('1000', '0.0123', 100)).toBe(1230);
    // дробная часть отбрасывается
    expect(quoteGems('1', '0.019999', 100)).toBe(1);
  });

  it('converts usd price to gems with half-up rounding', () => {
    expect(usdToGemsRounded('0.015', 100)).toBe(2);
    expect(usdToGemsRounded('0.014', 100)).toBe(1);
    expect(usdToGemsRounded('25.5', 100)).toBe(2550);
  });
});
