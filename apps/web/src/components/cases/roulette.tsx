'use client';

import type { CaseContentItemDto, ItemDto } from '@gunraid/shared';
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type Ref } from 'react';
import { SkinCard } from '@/components/items/skin-card';
import {
  IDLE_INDEX,
  IDLE_LENGTH,
  WIN_INDEX,
  buildStrip,
  laneSeed,
  reelOffset,
  stripSeeds,
  type ReelGeometry,
} from '@/lib/case-page';
import { prefersReducedMotion } from '@/lib/motion';
import { sound } from '@/lib/sound';

/** Плавное торможение прокрутки (как и раньше). */
const SPIN_EASING = 'cubic-bezier(0.06, 0.62, 0.1, 1)';
/** Последние 350 мс лента доезжает от случайной точки внутри выигрышной карточки ровно до её центра. */
const SETTLE_MS = 350;

type Axis = 'x' | 'y';

interface ReelProps {
  axis: Axis;
  pool: CaseContentItemDto[];
  /** Выигрыш (решён сервером). null — только у дропленты: витрина в покое, без прокрутки. */
  winner: ItemDto | null;
  spinId: number;
  seed: number;
  fast: boolean;
  durationMs: number;
  onDone: () => void;
  /**
   * Дроплента телефона: классы .case-strip__*, карточки 90×60 (skin-card--reel). В покое — первые IDLE_LENGTH
   * карточек ленты, под меткой карточка IDLE_INDEX (сдвиг — в CSS, сервер рисует так же); прокрутка начинается
   * с неё же — при старте ничего не подменяется и не прыгает. Выигрыш стоит под меткой до следующей прокрутки.
   */
  strip?: boolean;
}

/**
 * Одна лента. x — едет влево (сдвиг отрицательный); y — дорожка привязана к низу окна
 * (карточки снизу вверх) и едет вниз, как барабан (сдвиг положительный).
 */
function Reel({
  axis,
  pool,
  winner,
  spinId,
  seed,
  fast,
  durationMs,
  onDone,
  strip = false,
}: ReelProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** Дроплента стоит на выигрыше прошлой прокрутки (рулетка сцены каждый раз монтируется заново). */
  const shownRef = useRef(false);
  const cards = useMemo(() => {
    const all = buildStrip(pool, winner, seed);
    return strip && !winner ? all.slice(0, IDLE_LENGTH) : all;
  }, [pool, winner, seed, strip]);
  const horizontal = axis === 'x';

  // До отрисовки (layout-эффект): у дропленты ключи карточек — позиции, и новая лента приходит в те же
  // узлы, пока сдвиг дорожки ещё стоит на выигрыше прошлой прокрутки. Обычный эффект после ответа сервера
  // (не по клику) React может выполнить уже после кадра — под меткой на кадр мелькнул бы новый выигрыш.
  // Здесь сброс, затухание и старт успевают до первой отрисовки; рулетке сцены это не мешает.
  useLayoutEffect(() => {
    const win = windowRef.current;
    const track = trackRef.current;
    if (!win || !track) return;
    if (!winner) {
      // Витрина дропленты (в том числе после смены количества): сдвиг — из CSS.
      track.getAnimations().forEach((a) => a.cancel());
      track.style.transform = '';
      shownRef.current = false;
      return;
    }
    const first = track.children[0];
    const second = track.children[1];
    if (!first || !second) return;

    // Геометрия берётся из вёрстки: размер карточки зависит от ширины экрана (container queries).
    // Дробные размеры (getBoundingClientRect): округление offsetWidth на уменьшенной карточке
    // за 46 карточек набегает в заметный сдвиг. Шаг — расстояние между соседними карточками.
    const measure = (): ReelGeometry => {
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      const v = win.getBoundingClientRect();
      return horizontal
        ? { card: a.width, pitch: Math.abs(b.left - a.left), view: v.width }
        : { card: a.height, pitch: Math.abs(b.top - a.top), view: v.height };
    };
    /** Сдвиг ленты, при котором карточка i стоит ровно под меткой (по центру окна). */
    const centred = (i: number, g = measure()) => reelOffset(i, g, axis);
    const tf = (v: number) => (horizontal ? `translateX(${v}px)` : `translateY(${v}px)`);
    /**
     * Итоговое положение — инлайн-стилем и по свежим замерам: пока лента ехала или стояла
     * под окном результата, экран могли повернуть или сузить — выигрыш всё равно ровно под меткой.
     */
    const settle = () => {
      track.getAnimations().forEach((a) => a.cancel());
      track.style.transform = tf(centred(WIN_INDEX));
      shownRef.current = true;
    };
    let finished = false;
    const ro = new ResizeObserver(() => {
      if (finished) settle();
    });
    ro.observe(win);

    track.getAnimations().forEach((a) => a.cancel());
    // Новая лента вместо показанного выигрыша (дроплента) появляется плавно — как рулетка сцены (gr-fade-in).
    if (shownRef.current && !prefersReducedMotion())
      win.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    shownRef.current = false;
    if (fast || prefersReducedMotion()) {
      finished = true;
      settle();
      onDone();
      return () => ro.disconnect();
    }

    const g = measure();
    // Дроплента стартует с карточки витрины (она уже под меткой), рулетка сцены — с начала ленты.
    const from = strip ? centred(IDLE_INDEX, g) : 0;
    const target = centred(WIN_INDEX, g);
    const jitter = (Math.random() - 0.5) * g.card * 0.7;
    track.style.transform = tf(from);
    const anim = track.animate(
      [
        { transform: tf(from), easing: SPIN_EASING },
        {
          transform: tf(target + jitter),
          offset: Math.max(0, 1 - SETTLE_MS / durationMs),
          easing: 'ease-in-out',
        },
        { transform: tf(target) },
      ],
      { duration: durationMs, fill: 'forwards' },
    );
    // Щелчок на каждой карточке, проходящей под меткой.
    let last = -1;
    let raf = 0;
    const loop = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const offset = horizontal ? m.m41 : m.m42;
      const idx = Math.floor((g.view / 2 + (horizontal ? -offset : offset)) / g.pitch);
      if (idx !== last) {
        last = idx;
        sound.tick();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    anim.onfinish = () => {
      cancelAnimationFrame(raf);
      finished = true;
      settle();
      onDone();
    };
    return () => {
      cancelAnimationFrame(raf);
      anim.onfinish = null;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId, winner]);

  return (
    <div
      ref={windowRef}
      className={
        strip ? 'case-strip__window' : horizontal ? 'case-reel__window' : 'case-lane__window'
      }
    >
      <div
        ref={trackRef}
        className={
          strip ? 'case-strip__track' : horizontal ? 'case-reel__track' : 'case-lane__track'
        }
      >
        {cards.map((entry, i) =>
          strip ? (
            // Ключ — позиция: витрина и начало прокрутки — те же карточки, DOM не пересоздаётся.
            <SkinCard
              key={i}
              item={entry.item}
              chance={entry.chance}
              eager={Boolean(winner)}
              className="skin-card--reel"
              data-testid="case-strip-card"
            />
          ) : (
            <SkinCard key={`${spinId}-${i}`} item={entry.item} chance={entry.chance} eager />
          ),
        )}
      </div>
    </div>
  );
}

export interface CaseRouletteProps {
  pool: CaseContentItemDto[];
  /** Выигрыши по дорожкам (решены сервером); их число — число дорожек. */
  winners: ItemDto[];
  spinId: number;
  fast: boolean;
  onLaneDone: (lane: number) => void;
}

/**
 * Рулетка на месте сцены кейса (планшет и десктоп): x1 — горизонтальная лента на всю ширину экрана
 * с лаймовой меткой сверху; x2…x5 — вертикальные дорожки там, где стояли копии кейса, с меткой слева
 * от каждой. Дорожки останавливаются по очереди (каждая следующая на 250 мс позже).
 */
export function CaseRoulette({ pool, winners, spinId, fast, onLaneDone }: CaseRouletteProps) {
  const n = winners.length;
  if (n <= 1) {
    return (
      <div className="case-reel" aria-hidden="true" data-testid="case-roulette" data-lanes={1}>
        <Reel
          axis="x"
          pool={pool}
          winner={winners[0] ?? null}
          spinId={spinId}
          seed={laneSeed(spinId, 0)}
          fast={fast}
          durationMs={5600}
          onDone={() => onLaneDone(0)}
        />
        <span className="case-reel__marker case-reel__marker--x" />
      </div>
    );
  }
  return (
    <div
      className="case-band__row"
      style={{ '--n': n } as CSSProperties}
      aria-hidden="true"
      data-testid="case-roulette"
      data-lanes={n}
    >
      {winners.map((winner, i) => (
        <div key={i} className="case-lane" data-testid="case-lane">
          <Reel
            axis="y"
            pool={pool}
            winner={winner}
            spinId={spinId}
            seed={laneSeed(spinId, i)}
            fast={fast}
            durationMs={5600 + i * 250}
            onDone={() => onLaneDone(i)}
          />
          <span className="case-reel__marker case-reel__marker--y" />
        </div>
      ))}
    </div>
  );
}

export interface CaseStripProps {
  pool: CaseContentItemDto[];
  /** Лент в покое — выбранное количество. */
  count: number;
  /** Выигрыши прокрутки на телефоне по лентам (их число — число лент); null — витрина. */
  winners: ItemDto[] | null;
  spinId: number;
  fast: boolean;
  onLaneDone: (lane: number) => void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Дроплента — блок страницы кейса на телефоне (< 768; шире скрыта в CSS): под строкой кнопки открытия,
 * от края до края экрана, N лент через 12, над каждой — лаймовая метка. В покое — витрина: начало ленты
 * следующей прокрутки (stripSeeds(pool, spinId + 1, …): у лент свои, несвязанные наборы карточек), под меткой
 * карточка IDLE_INDEX. При открытии лента едет от неё к выигрышу (WIN_INDEX), ленты останавливаются по очереди
 * (+250 мс), как дорожки рулетки сцены; выигрыш остаётся под меткой до следующего открытия или смены количества.
 * Скрыта от экранных читалок: результат объявляет окно.
 */
export function CaseStrip({ pool, count, winners, spinId, fast, onLaneDone, ref }: CaseStripProps) {
  const lanes = winners ? winners.length : count;
  const seedSpin = winners ? spinId : spinId + 1;
  const seeds = useMemo(() => stripSeeds(pool, seedSpin, lanes), [pool, seedSpin, lanes]);
  return (
    <div
      ref={ref}
      className="case-strip"
      style={{ '--idle': IDLE_INDEX } as CSSProperties}
      aria-hidden="true"
      data-testid="case-strip"
      data-lanes={lanes}
      data-state={winners ? 'spun' : 'idle'}
    >
      {Array.from({ length: lanes }, (_, i) => (
        <div key={i} className="case-strip__lane" data-testid="case-strip-lane">
          <span className="case-strip__marker" data-testid="case-strip-marker" />
          <Reel
            strip
            axis="x"
            pool={pool}
            winner={winners?.[i] ?? null}
            spinId={spinId}
            seed={seeds[i]!}
            fast={fast}
            durationMs={5600 + i * 250}
            onDone={() => onLaneDone(i)}
          />
        </div>
      ))}
    </div>
  );
}
