'use client';

import type { CaseContentItemDto, ItemDto } from '@gunraid/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { sound } from '@/lib/sound';

const STRIP_LENGTH = 54;
const WIN_INDEX = 46;

/** Косметическая лента: наполнители по шансам кейса, выигрыш (решённый сервером) — на позиции WIN_INDEX. */
function buildStrip(pool: CaseContentItemDto[], winner: ItemDto | null, seed: number): ItemDto[] {
  if (!pool.length) return [];
  let x = seed || 1;
  const rand = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const total = pool.reduce((s, p) => s + p.odds, 0);
  const pick = () => {
    // Чуть чаще показываем редкие предметы, чтобы лента выглядела живой.
    let r = rand() * total;
    for (const p of pool) {
      r -= p.odds;
      if (r <= 0) return p.item;
    }
    return (pool[pool.length - 1] as CaseContentItemDto).item;
  };
  const strip = Array.from({ length: STRIP_LENGTH }, (_, i) => {
    if (i % 7 === 3)
      return (pool[Math.floor(rand() * Math.min(3, pool.length))] as CaseContentItemDto).item;
    return pick();
  });
  if (winner) strip[WIN_INDEX] = winner;
  return strip;
}

export interface RouletteProps {
  pool: CaseContentItemDto[];
  winner: ItemDto | null;
  spinId: number;
  fast: boolean;
  compact?: boolean;
  durationMs?: number;
  onDone?: () => void;
}

export function Roulette({
  pool,
  winner,
  spinId,
  fast,
  compact,
  durationMs = 5800,
  onDone,
}: RouletteProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const strip = useMemo(
    () => buildStrip(pool, winner, spinId * 9301 + 49297),
    [pool, winner, spinId],
  );
  const cardW = compact ? 104 : 148;

  useEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    if (!vp || !tr || !winner) return;
    setDone(false);
    const width = vp.clientWidth;
    const jitter = (Math.random() - 0.5) * cardW * 0.7;
    const target = -(WIN_INDEX * cardW) + width / 2 - cardW / 2 + jitter;
    tr.getAnimations().forEach((a) => a.cancel());
    tr.style.transform = 'translateX(0px)';
    if (fast) {
      tr.style.transform = `translateX(${target}px)`;
      setDone(true);
      onDone?.();
      return;
    }
    const anim = tr.animate(
      [{ transform: 'translateX(0px)' }, { transform: `translateX(${target}px)` }],
      {
        duration: durationMs,
        easing: 'cubic-bezier(0.06, 0.62, 0.1, 1)',
        fill: 'forwards',
      },
    );
    let last = -1;
    let raf = 0;
    const loop = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(tr).transform);
      const idx = Math.floor((-m.m41 + width / 2) / cardW);
      if (idx !== last) {
        last = idx;
        sound.tick();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    anim.onfinish = () => {
      cancelAnimationFrame(raf);
      setDone(true);
      onDone?.();
    };
    return () => {
      cancelAnimationFrame(raf);
      anim.onfinish = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId, winner]);

  return (
    <div
      ref={viewport}
      className={cn(
        'cut relative overflow-hidden [--cut-bg:var(--color-surface-1)]',
        compact ? 'h-[118px]' : 'h-[172px]',
      )}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-0.5 -translate-x-1/2 bg-accent shadow-[0_0_14px_rgba(198,255,0,0.9)]"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-surface-1 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-surface-1 to-transparent" />
      <div
        ref={track}
        className="flex h-full items-center will-change-transform"
        style={{ transform: 'translateX(0px)' }}
      >
        {strip.map((it, i) => (
          <div key={`${spinId}-${i}`} className="shrink-0 px-1" style={{ width: cardW }}>
            <div
              className={cn(
                'relative flex flex-col items-center justify-center overflow-hidden bg-surface-2 transition',
                compact ? 'h-[96px]' : 'h-[146px]',
                done && i === WIN_INDEX && 'ring-2 ring-accent',
              )}
              style={{
                background: `radial-gradient(90% 70% at 50% 100%, ${it.rarity.color}45, var(--color-surface-2) 70%)`,
              }}
            >
              {it.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.imageUrl}
                  alt=""
                  className={cn('object-contain', compact ? 'h-12 w-20' : 'h-20 w-32')}
                  draggable={false}
                />
              )}
              {!compact && (
                <div className="mt-1 w-full truncate px-2 text-center text-[11px] font-semibold">
                  {it.skinName}
                </div>
              )}
              <div
                className="absolute inset-x-0 bottom-0 h-[3px]"
                style={{ background: it.rarity.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
