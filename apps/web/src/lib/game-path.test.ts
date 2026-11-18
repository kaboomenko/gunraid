import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';
import { switchGamePath } from './game';

const GAMES = ['standoff2', 'cs2'];

describe('switchGamePath', () => {
  it('keeps the section when switching game', () => {
    expect(switchGamePath('/standoff2/upgrade', 'cs2', GAMES)).toBe('/cs2/upgrade');
    expect(switchGamePath('/standoff2', 'cs2', GAMES)).toBe('/cs2');
    expect(switchGamePath('/cs2/profile', 'standoff2', GAMES)).toBe('/standoff2/profile');
  });

  it('drops entity pages that do not exist in another game', () => {
    expect(switchGamePath('/standoff2/case/some-case', 'cs2', GAMES)).toBe('/cs2');
    expect(switchGamePath('/standoff2/battles/0190-uuid', 'cs2', GAMES)).toBe('/cs2/battles');
  });

  it('goes to the game home from non-game pages', () => {
    expect(switchGamePath('/faq', 'cs2', GAMES)).toBe('/cs2');
  });
});

describe('ru messages', () => {
  it('declines gems in Russian', () => {
    expect(ru.gems.amount).toContain('one {# гем}');
    expect(ru.gems.amount).toContain('few {# гема}');
    expect(ru.gems.amount).toContain('many {# гемов}');
  });
});
