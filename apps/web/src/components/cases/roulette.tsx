'use client';

import type { CaseContentItemDto, ItemDto } from '@gunraid/shared';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { SkinCard } from '@/components/items/skin-card';
import { prefersReducedMotion } from '@/lib/motion';
import { sound } from '@/lib/sound';

const STRIP_LENGTH = 54;
const WIN_INDEX = 46;
/** Плавное торможение прокрутки (как и раньше). */
const SPIN_EASING = 'cubic-bezier(0.06, 0.62, 0.1, 1)';
/** Последние 350 мс лента доезжает от случайной точки внутри выигрышной карточки ровно до её центра. */
const SETTLE_MS = 350;

/**
 * Косметическая лента: наполнители по шансам кейса, выигрыш (решённый сервером) — на позиции
 * WIN_INDEX. У каждой дорожки свой seed, чтобы при x2…x5 ленты не повторяли друг друга.
 */
function buildStrip(
  pool: CaseContentItemDto[],
  winner: ItemDto | null,
  seed: number,
): CaseContentItemDto[] {
  if (!pool.length) return [];
  let x = seed % 2147483647 || 1;
  const rand = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const total = pool.reduce((s, p) => s + p.odds, 0);
  const pick = () => {
    let r = rand() * total;
    for (const p of pool) {
      r -= p.odds;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1] as CaseContentItemDto;
  };
  const strip = Array.from({ length: STRIP_LENGTH }, (_, i) => {
    // Чуть чаще показываем самые ценные предметы (они первые в составе), чтобы лента выглядела живой.
    if (i % 7 === 3)
      return pool[Math.floor(rand() * Math.min(3, pool.length))] as CaseContentItemDto;
    return pick();
  });
  if (winner) {
    const entry = pool.find((p) => p.item.id === winner.id);
    strip[WIN_INDEX] = { item: winner, odds: entry?.odds ?? 0, chance: entry?.chance ?? '' };
  }
  return strip;
}

type Axis = 'x' | 'y';

interface ReelProps {
  axis: Axis;
  pool: CaseContentItemDto[];
  winner: ItemDto | null;
  spinId: number;
  seed: number;
  fast: boolean;
  durationMs: number;
  onDone: () => void;
}

/**
 * Одна лента. x — едет влево (сдвиг отрицательный); y — дорожка привязана к низу окна
 * (карточки снизу вверх) и едет вниз, как барабан (сдвиг положительный).
 */
function Reel({ axis, pool, winner, spinId, seed, fast, durationMs, onDone }: ReelProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const strip = useMemo(() => buildStrip(pool, winner, seed), [pool, winner, seed]);
  const horizontal = axis === 'x';

  useEffect(() => {
    const win = windowRef.current;
    const track = trackRef.current;
    const first = track?.children[0];
    const second = track?.children[1];
    if (!win || !track || !first || !second || !winner) return;

    // Геометрия берётся из вёрстки: размер карточки зависит от ширины экрана (container queries).
    // Дробные размеры (getBoundingClientRect): округление offsetWidth на уменьшенной карточке
    // за 46 карточек набегает в заметный сдвиг. Шаг — расстояние между соседними карточками.
    const measure = () => {
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      const v = win.getBoundingClientRect();
      return horizontal
        ? { card: a.width, pitch: Math.abs(b.left - a.left), view: v.width }
        : { card: a.height, pitch: Math.abs(b.top - a.top), view: v.height };
    };
    /** Сдвиг ленты, при котором карточка i стоит ровно под меткой (по центру окна). */
    const centred = (i: number, g = measure()) =>
      horizontal ? g.view / 2 - (i * g.pitch + g.card / 2) : i * g.pitch + g.card / 2 - g.view / 2;
    const tf = (v: number) => (horizontal ? `translateX(${v}px)` : `translateY(${v}px)`);
    /**
     * Итоговое положение — инлайн-стилем и по свежим замерам: пока лента ехала или стояла
     * под окном результата, экран могли повернуть или сузить — выигрыш всё равно ровно под меткой.
     */
    const settle = () => {
      track.getAnimations().forEach((a) => a.cancel());
      track.style.transform = tf(centred(WIN_INDEX));
    };
    let finished = false;
    const ro = new ResizeObserver(() => {
      if (finished) settle();
    });
    ro.observe(win);

    track.getAnimations().forEach((a) => a.cancel());
    if (fast || prefersReducedMotion()) {
      finished = true;
      settle();
      onDone();
      return () => ro.disconnect();
    }

    const g = measure();
    const target = centred(WIN_INDEX, g);
    const jitter = (Math.random() - 0.5) * g.card * 0.7;
    track.style.transform = tf(0);
    const anim = track.animate(
      [
        { transform: tf(0), easing: SPIN_EASING },
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
    <div ref={windowRef} className={horizontal ? 'case-reel__window' : 'case-lane__window'}>
      <div ref={trackRef} className={horizontal ? 'case-reel__track' : 'case-lane__track'}>
        {strip.map((entry, i) => (
          <SkinCard key={`${spinId}-${i}`} item={entry.item} chance={entry.chance} eager />
        ))}
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
 * Рулетка на месте сцены кейса: x1 — горизонтальная лента на всю ширину экрана с лаймовой меткой
 * сверху; x2…x5 — вертикальные дорожки там, где стояли копии кейса, с меткой слева от каждой.
 * Дорожки останавливаются по очереди (каждая следующая на 250 мс позже).
 */
export function CaseRoulette({ pool, winners, spinId, fast, onLaneDone }: CaseRouletteProps) {
  const n = winners.length;
  const seed = spinId * 9301 + 49297;
  if (n <= 1) {
    return (
      <div className="case-reel" aria-hidden="true" data-testid="case-roulette" data-lanes={1}>
        <Reel
          axis="x"
          pool={pool}
          winner={winners[0] ?? null}
          spinId={spinId}
          seed={seed}
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
            seed={seed + i * 7919}
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
