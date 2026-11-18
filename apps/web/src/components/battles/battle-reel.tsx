'use client';

import type { CaseContentItemDto, ItemDto } from '@gunraid/shared';
import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { serverNow } from '@/lib/socket';
import { sound } from '@/lib/sound';
import { prefersReducedMotion, REDUCED_MOTION_MS } from '@/lib/motion';

const LENGTH = 36;
const WIN_INDEX = 30;
/** Высота ячейки — доля высоты окна рулетки (видно ~2,5 предмета). */
const PER_VIEW = 2.5;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Косметическая лента из содержимого кейса; выигрыш (решённый сервером) — на позиции WIN_INDEX. */
function buildStrip(pool: CaseContentItemDto[], winner: ItemDto, key: string): ItemDto[] {
  let x = hash(key) || 1;
  const rand = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const total = pool.reduce((s, p) => s + p.odds, 0);
  const pick = () => {
    if (!pool.length) return winner;
    let r = rand() * total;
    for (const p of pool) {
      r -= p.odds;
      if (r <= 0) return p.item;
    }
    return pool[pool.length - 1]!.item;
  };
  const strip = Array.from({ length: LENGTH }, (_, i) =>
    i % 6 === 2 && pool.length ? pool[Math.floor(rand() * Math.min(3, pool.length))]!.item : pick(),
  );
  strip[WIN_INDEX] = winner;
  return strip;
}

export interface BattleReelProps {
  pool: CaseContentItemDto[];
  winner: ItemDto | null;
  /** Старт вращения по часам сервера (мс). */
  startAt: number;
  durationMs: number;
  spinKey: string;
  idleImage?: string | null;
  compact?: boolean;
  ticks?: boolean;
  highlight?: boolean;
}

/**
 * Вертикальная рулетка участника баттла. Старт — по серверному времени, поэтому у всех зрителей
 * рулетки идут синхронно; опоздавший подхватывает анимацию с нужного места.
 */
export function BattleReel({
  pool,
  winner,
  startAt,
  durationMs,
  spinKey,
  idleImage,
  compact,
  ticks,
  highlight,
}: BattleReelProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const strip = useMemo(
    () => (winner ? buildStrip(pool, winner, spinKey) : []),
    [pool, winner, spinKey],
  );

  useEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    if (!vp || !tr || !winner) return;
    const height = vp.clientHeight;
    const itemH = height / PER_VIEW;
    const jitter = ((hash(`${spinKey}:j`) % 1000) / 1000 - 0.5) * itemH * 0.6;
    const target = -(WIN_INDEX * itemH) + height / 2 - itemH / 2 + jitter;
    tr.getAnimations().forEach((a) => a.cancel());
    const elapsed = serverNow() - startAt;
    if (elapsed >= durationMs) {
      tr.style.transform = `translateY(${target}px)`;
      return;
    }
    tr.style.transform = 'translateY(0px)';
    const reduced = prefersReducedMotion();
    // «Уменьшить движение»: без прокрутки — короткий переход к результату в тот же момент,
    // когда у остальных зрителей останавливается рулетка.
    const anim = reduced
      ? tr.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${target}px)` }], {
          duration: REDUCED_MOTION_MS,
          delay: Math.max(0, durationMs - REDUCED_MOTION_MS - elapsed),
          easing: 'ease-out',
          fill: 'both',
        })
      : tr.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${target}px)` }], {
          duration: durationMs,
          delay: Math.max(0, -elapsed),
          easing: 'cubic-bezier(0.08, 0.6, 0.12, 1)',
          fill: 'both',
        });
    if (elapsed > 0 && !reduced) anim.currentTime = elapsed;
    let raf = 0;
    if (ticks && !reduced) {
      let last = -1;
      const loop = () => {
        const m = new DOMMatrixReadOnly(getComputedStyle(tr).transform);
        const idx = Math.floor((-m.m42 + height / 2) / itemH);
        if (idx !== last && serverNow() >= startAt) {
          if (last !== -1) sound.tick();
          last = idx;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      anim.onfinish = () => cancelAnimationFrame(raf);
    }
    return () => {
      cancelAnimationFrame(raf);
      anim.onfinish = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey, winner?.id, startAt]);

  return (
    <div
      ref={viewport}
      className={cn(
        'relative h-[var(--reel-h)] overflow-hidden bg-surface-2/50',
        compact ? '[--reel-h:150px] md:[--reel-h:190px]' : '[--reel-h:180px] md:[--reel-h:230px]',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-1/2 z-10 h-0.5 -translate-y-1/2 shadow-[0_0_14px_rgba(198,255,0,0.9)]',
          highlight === false ? 'bg-line-strong shadow-none' : 'bg-accent',
        )}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-surface-1 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-surface-1 to-transparent" />
      {winner ? (
        <div ref={track} className="will-change-transform">
          {strip.map((it, i) => (
            <div
              key={`${spinKey}-${i}`}
              className="flex h-[calc(var(--reel-h)/2.5)] items-center justify-center px-3 py-1"
            >
              <div
                className="relative h-full w-full max-w-[220px]"
                style={{
                  background: `radial-gradient(70% 70% at 50% 100%, ${it.rarity.color}40, transparent 70%)`,
                }}
              >
                {it.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.imageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain p-1"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-full place-items-center">
          {idleImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={idleImage} alt="" className="h-1/2 w-1/2 object-contain opacity-40" />
          )}
        </div>
      )}
    </div>
  );
}
