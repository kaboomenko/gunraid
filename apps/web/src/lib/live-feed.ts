/**
 * Геометрия ленты дропов (components/layout/live-feed.tsx) — из разметки, а не константами: размеры
 * карточек задаёт только CSS (телефон 90 + 3, от 768 — 240 + 6), смена ширины окна работает сама.
 */

/** Положение и ширина карточки в дорожке (HTMLElement: offsetLeft, offsetWidth). */
export interface CardBox {
  offsetLeft: number;
  offsetWidth: number;
}

/**
 * Шаг ленты: начало второй карточки минус начало первой (93 на телефоне, 246 от 768); transform дорожки
 * на offsetLeft не влияет. cards — карточки дорожки по порядку; карточка одна — её ширина + gap, нет — 0.
 */
export function trackStep(cards: ArrayLike<CardBox> | null | undefined, gap = 0): number {
  const a = cards?.[0];
  const b = cards?.[1];
  if (a && b) return b.offsetLeft - a.offsetLeft;
  return a ? a.offsetWidth + gap : 0;
}

/** Сколько карточек может быть на виду в окне ширины width (+1 — частично видимая); шага нет — повторять нельзя. */
export function visibleCards(width: number, step: number): number {
  return step > 0 ? Math.ceil(width / step) + 1 : Number.POSITIVE_INFINITY;
}

/**
 * Сколько карточек помещается в окно ширины width целиком, пока дорожка в покое у левого края окна (на 360 —
 * три по 90 + 3 в окне 287): только они — остановки Tab. Считается по первой карточке и шагу, а не по числу
 * карточек: пришли новые дропы — пересчитывать не нужно. gap — зазор дорожки: при одной карточке (лента была
 * пуста, дропы пришли по сокету) шаг — её ширина + gap, и счёт тот же, что у полной ленты. Карточек нет — 0;
 * окно уже карточки — всё равно 1, чтобы лента оставалась доступной с клавиатуры.
 */
export function fullCards(
  width: number,
  cards: ArrayLike<CardBox> | null | undefined,
  gap = 0,
): number {
  const first = cards?.[0];
  if (!first) return 0;
  const step = trackStep(cards, gap);
  const fit = step > 0 ? Math.floor((width - first.offsetWidth) / step) + 1 : 1;
  return Math.max(1, fit);
}
