import { describe, expect, it } from 'vitest';
import { fullCards, trackStep, visibleCards } from './live-feed';

const card = (offsetLeft: number, offsetWidth: number) => ({ offsetLeft, offsetWidth });

describe('trackStep', () => {
  it('measures the step between the first two cards', () => {
    // телефон: карточка 90 + зазор 3; от 768 — 240 + 6
    expect(trackStep([card(0, 90), card(93, 90)])).toBe(93);
    expect(trackStep([card(0, 240), card(246, 240), card(492, 240)])).toBe(246);
    // дорожка сдвинута transform — offsetLeft его не учитывает, но и разность от сдвига не зависит
    expect(trackStep([card(73, 90), card(166, 90)])).toBe(93);
  });

  it('falls back to one card width plus the gap', () => {
    expect(trackStep([card(0, 90)], 3)).toBe(93);
    expect(trackStep([card(0, 90)])).toBe(90);
  });

  it('is zero without cards', () => {
    expect(trackStep(null)).toBe(0);
    expect(trackStep(undefined)).toBe(0);
    expect(trackStep([], 3)).toBe(0);
  });
});

describe('visibleCards', () => {
  it('counts the cards that fit the window plus a partly visible one', () => {
    // окно ленты на 360: x 73…360 = 287 → 4 карточки по 93 (последняя частично) + 1
    expect(visibleCards(287, 93)).toBe(5);
    expect(visibleCards(1641, 246)).toBe(8);
    expect(visibleCards(186, 93)).toBe(3);
  });

  it('never allows repeating without a step', () => {
    expect(visibleCards(300, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fullCards', () => {
  /** Дорожка из 60 карточек (столько держит лента): телефон 90 + 3 с x 73, от 768 — 240 + 6. */
  const track = (width: number, step: number, x0 = 0) =>
    Array.from({ length: 60 }, (_, i) => card(x0 + i * step, width));
  const phone = track(90, 93, 73);
  const desk = track(240, 246);

  it('counts only the cards that fit the window entirely', () => {
    // 360: окно 287 — 73…163, 166…256, 259…349 целиком, четвёртая видна на 8 px
    expect(fullCards(287, phone)).toBe(3);
    // 280: окно 207 — две; 767: окно 694 — семь
    expect(fullCards(207, phone)).toBe(2);
    expect(fullCards(694, phone)).toBe(7);
    // ровно впритык — карточка целиком
    expect(fullCards(276, phone)).toBe(3);
    expect(fullCards(275, phone)).toBe(2);
    // от 768: 1024 — окно 745, 1920 — 1641
    expect(fullCards(745, desk)).toBe(3);
    expect(fullCards(1641, desk)).toBe(6);
  });

  it('depends on the geometry, not on how many cards there are yet', () => {
    expect(fullCards(287, phone.slice(0, 2))).toBe(3);
    // одна карточка: шага между карточками нет — это её ширина + зазор дорожки (компонент берёт его из стиля)
    expect(fullCards(287, [card(0, 90)], 3)).toBe(3);
  });

  it('counts one card with the track gap the same as two and more (feed was empty, drops come by socket)', () => {
    // остановки считаются, когда приходит первая карточка; при второй и следующих пересчёта нет
    for (const width of [207, 272, 287, 364, 694]) {
      const all = fullCards(width, phone);
      expect(fullCards(width, phone.slice(0, 1), 3)).toBe(all);
      expect(fullCards(width, phone.slice(0, 2), 3)).toBe(all);
    }
    for (const width of [721, 745, 1641]) {
      expect(fullCards(width, desk.slice(0, 1), 6)).toBe(fullCards(width, desk));
    }
    // без зазора шаг одной карточки короче: на 345 (окно 272) и 1000 (721) была бы лишняя остановка у края окна
    expect(fullCards(272, phone.slice(0, 1))).toBe(3);
    expect(fullCards(272, phone)).toBe(2);
    expect(fullCards(721, desk.slice(0, 1))).toBe(3);
    expect(fullCards(721, desk)).toBe(2);
  });

  it('keeps one tab stop in a too narrow window and none without cards', () => {
    expect(fullCards(60, phone)).toBe(1);
    expect(fullCards(287, [])).toBe(0);
    expect(fullCards(287, undefined)).toBe(0);
    expect(fullCards(287, null)).toBe(0);
  });
});
