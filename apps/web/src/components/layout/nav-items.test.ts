import { describe, expect, it } from 'vitest';
import ru from '../../../messages/ru.json';
import { MENU_NAV, isActive } from './nav-items';

/** Значение по пути «a.b.c» в ru.json. */
const message = (path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      ru,
    );

describe('isActive', () => {
  it('marks cases on the game home and on case pages only', () => {
    expect(isActive('/standoff2', 'standoff2', '')).toBe(true);
    expect(isActive('/standoff2/case/first-blood', 'standoff2', '')).toBe(true);
    expect(isActive('/standoff2/upgrade', 'standoff2', '')).toBe(false);
  });

  it('marks a section on its own page and nested pages', () => {
    expect(isActive('/standoff2/cargo/light', 'standoff2', '/cargo')).toBe(true);
    expect(isActive('/standoff2/leaderboard', 'standoff2', '/leaderboard')).toBe(true);
    expect(isActive('/cs2/leaderboard', 'standoff2', '/leaderboard')).toBe(false);
    expect(isActive('/standoff2/upgrades', 'standoff2', '/upgrade')).toBe(false);
  });
});

describe('MENU_NAV', () => {
  it('lists seven unique sections', () => {
    expect(MENU_NAV).toHaveLength(7);
    expect(new Set(MENU_NAV.map((i) => i.key)).size).toBe(7);
    expect(new Set(MENU_NAV.map((i) => i.path)).size).toBe(7);
  });

  it('has a label for every section in ru.json', () => {
    for (const item of MENU_NAV) expect(typeof message(item.label), item.label).toBe('string');
  });

  it('names the leaderboard after its page', () => {
    const item = MENU_NAV.find((i) => i.key === 'leaderboard');
    expect(item?.label).toBe('leaderboard.title');
    expect(message('leaderboard.title')).toBe(ru.leaderboard.title);
  });
});
