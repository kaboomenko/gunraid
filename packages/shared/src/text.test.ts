import { describe, expect, it } from 'vitest';
import { hasUnsafeText } from './text.js';

describe('hasUnsafeText', () => {
  it('rejects NUL and unpaired surrogates (PostgreSQL does not store them as is)', () => {
    for (const s of [
      '\u0000',
      'ab\u0000cd',
      'ab\ud800cd',
      'ab\udc00cd',
      '\ud83d',
      'x\ude00',
      '\ude00\ud83d',
    ]) {
      expect(hasUnsafeText(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('accepts ordinary text, emoji (surrogate pairs) and other control characters', () => {
    for (const s of [
      '',
      'Лёгкий груз',
      'Груз 🎁 №1',
      '\ud83d\ude00x',
      'a\tb\nc',
      '\u0001',
      '\uffff',
    ]) {
      expect(hasUnsafeText(s), JSON.stringify(s)).toBe(false);
    }
  });
});
