'use client';

import { useEffect, useRef } from 'react';
import type { DriftAvoid } from '@/lib/snow-drift';

/** Элементы полосы, к низу которых сугроб не подходит: текст (data-drift-avoid="lines" — по строкам) и кнопки. */
const AVOID = '[data-drift-avoid]';

interface Line {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Строки текста элемента (вьюпорт): у каждой своя ширина (строки по центру), низ — не ниже строки; нижняя
 * строка — во всю ширину блока (к ней сугроб ближе всего, запас по краям не помешает).
 */
function textLines(el: HTMLElement, box: DOMRect): Line[] {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const lines: Line[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (!(r.width > 0 && r.height > 0)) continue;
    const mid = (r.top + r.bottom) / 2;
    const line = lines.find((l) => mid > l.top && mid < l.bottom);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  range.detach();
  lines.sort((a, b) => a.top - b.top);
  // у шрифта область глифов выше межстрочного (line-height 100 %) — низ строки берём по межстрочному
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  lines.forEach((l, i) => {
    const lineBottom = Number.isFinite(lh) ? box.top + (i + 1) * lh : box.bottom;
    l.bottom = Math.min(l.bottom, lineBottom, box.bottom);
    if (i === lines.length - 1) {
      l.left = box.left;
      l.right = box.right;
    }
  });
  return lines.length
    ? lines
    : [{ left: box.left, right: box.right, top: box.top, bottom: box.bottom }];
}

/** Видимые элементы полосы, к низу которых сугроб не подходит, в css px от левого верхнего угла холста. */
function measureAvoid(strip: Element, canvas: HTMLCanvasElement): DriftAvoid[] {
  const base = canvas.getBoundingClientRect();
  const out: DriftAvoid[] = [];
  for (const el of Array.from(strip.querySelectorAll<HTMLElement>(AVOID))) {
    const box = el.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) continue; // скрыт (кнопка другого размера экрана)
    const parts = el.dataset.driftAvoid === 'lines' ? textLines(el, box) : [box];
    for (const r of parts) {
      out.push({
        left: r.left - base.left,
        right: r.right - base.left,
        bottom: r.bottom - base.top,
      });
    }
  }
  return out;
}

/** Отметка на полосе «кадр холста готов» — по ней CSS убирает заглушку (.promo-strip[data-drift='ready']::before). */
const READY = 'data-drift';
/** Первый кадр строился дольше (мс) — устройство медленное: смена заглушки на холст без проявления. */
const SLOW_MS = 1000;

/**
 * Сугроб внизу промо-полосы: силуэт эталона и снежные комья на Canvas 2D (lib/snow-drift.ts).
 * Холст — первый в полосе, полоса высотой ~46 px у её низа: под падающим снегом (PromoSnow), текстом и
 * кнопкой. Пока кадра нет (до JS, до простоя после гидратации, при смене масштаба) холст прозрачен и виден
 * тот же силуэт из CSS (.promo-strip::before); готовый кадр проявляется за 0,3 с. Модуль рисования
 * грузится отдельным чанком в первом простое после гидратации — до этого сугроб уже есть (заглушка).
 * Сугроб не подходит к низу текста и кнопки (data-drift-avoid): прямоугольники меряются перед каждым
 * кадром и после загрузки шрифтов.
 */
export function PromoDrift() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const strip = canvas?.parentElement;
    if (!canvas || !strip) return;
    const win = canvas.ownerDocument.defaultView;
    let stop: (() => void) | null = null;
    let live = true;
    let idle = 0;
    let timer = 0;
    const watch = (changed: () => void) => {
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => changed()) : null;
      strip.querySelectorAll(AVOID).forEach((el) => ro?.observe(el));
      const fonts = canvas.ownerDocument.fonts;
      let watching = true;
      fonts?.ready.then(
        () => watching && changed(),
        () => undefined,
      );
      fonts?.addEventListener('loadingdone', changed);
      return () => {
        watching = false;
        ro?.disconnect();
        fonts?.removeEventListener('loadingdone', changed);
      };
    };
    const begin = () => {
      idle = 0;
      timer = 0;
      const started = performance.now();
      let first = true;
      import('@/lib/snow-drift').then(
        ({ startSnowDrift }) => {
          if (!live) return;
          stop = startSnowDrift(canvas, {
            measure: () => measureAvoid(strip, canvas),
            watch,
            onReady: () => {
              if (first && performance.now() - started > SLOW_MS) {
                strip.style.setProperty('--drift-fade', '0s');
              }
              first = false;
              canvas.classList.add('is-ready');
              strip.setAttribute(READY, 'ready');
            },
            onStale: () => {
              canvas.classList.remove('is-ready');
              strip.removeAttribute(READY);
            },
          });
        },
        () => undefined, // чанк не загрузился — остаётся заглушка
      );
    };
    // модуль рисования — отдельный чанк: грузим в первом простое после гидратации
    if (win && typeof win.requestIdleCallback === 'function')
      idle = win.requestIdleCallback(begin, { timeout: 1500 });
    else if (win) timer = win.setTimeout(begin, 200);
    return () => {
      live = false;
      if (idle) win?.cancelIdleCallback(idle);
      if (timer) win?.clearTimeout(timer);
      stop?.();
      canvas.classList.remove('is-ready');
      strip.removeAttribute(READY);
      strip.style.removeProperty('--drift-fade');
    };
  }, []);

  return <canvas ref={ref} className="promo-drift" aria-hidden="true" data-testid="promo-drift" />;
}
