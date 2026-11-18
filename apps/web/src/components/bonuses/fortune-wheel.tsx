'use client';

import { formatGemsCompact, type WheelPrizeDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { sound } from '@/lib/sound';

const R = 200;
const C = 210;

/** Координаты округляются: иначе последние знаки Math.cos/sin на сервере и в браузере расходятся (гидратация). */
function polar(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(C + r * Math.cos(a)), round(C + r * Math.sin(a))];
}

function segmentPath(a0: number, a1: number): string {
  const [x0, y0] = polar(a0, R);
  const [x1, y1] = polar(a1, R);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
}

/** Контрастный цвет текста для сегмента. */
function ink(hex: string): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0B0B0F' : '#FFFFFF';
}

export interface FortuneWheelProps {
  prizes: WheelPrizeDto[];
  /** Индекс выпавшего приза (решён сервером) и номер вращения. */
  target: { index: number; spinId: string } | null;
  durationMs?: number;
  onDone?: () => void;
}

/** Колесо фортуны: SVG-сегменты по призам; вращение останавливает выпавший сегмент под указателем. */
export function FortuneWheel({ prizes, target, durationMs = 5200, onDone }: FortuneWheelProps) {
  const t = useTranslations('bonuses.wheel');
  const disc = useRef<SVGGElement>(null);
  const angle = useRef(0);
  const seg = 360 / Math.max(1, prizes.length);

  const short = (p: WheelPrizeDto): string => {
    switch (p.type) {
      case 'balance':
        return formatGemsCompact(p.amount ?? 0);
      case 'deposit_bonus':
        return t('short.deposit_bonus', { percent: Math.round((p.percent ?? 0) * 100) });
      case 'free_case':
        return t('short.free_case');
      case 'extra_spin':
        return t('short.extra_spin');
      default:
        return (p.item?.skinName ?? p.label).slice(0, 12);
    }
  };

  useEffect(() => {
    const g = disc.current;
    if (!g || !target) return;
    // Центр сегмента index — под указателем (0°), плюс небольшой разброс внутри сегмента.
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const want = 360 - (target.index * seg + seg / 2) + jitter;
    const current = angle.current;
    const base = current - (current % 360);
    const final = base + 360 * 6 + (((want % 360) + 360) % 360);
    angle.current = final;
    const anim = g.animate(
      [{ transform: `rotate(${current}deg)` }, { transform: `rotate(${final}deg)` }],
      { duration: durationMs, easing: 'cubic-bezier(0.12, 0.62, 0.08, 1)', fill: 'forwards' },
    );
    let last = Math.floor(current / seg);
    let raf = 0;
    const loop = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(g).transform);
      const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      const idx = Math.floor(((deg % 360) + 360) / seg);
      if (idx !== last) {
        last = idx;
        sound.tick();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    anim.onfinish = () => {
      cancelAnimationFrame(raf);
      onDone?.();
    };
    return () => {
      cancelAnimationFrame(raf);
      anim.onfinish = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.spinId]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg
        viewBox="0 0 420 420"
        className="h-full w-full drop-shadow-[0_0_40px_rgba(198,255,0,0.15)]"
      >
        <circle cx={C} cy={C} r={R + 8} fill="#15151B" stroke="#2C2C38" strokeWidth="2" />
        <g ref={disc} style={{ transformOrigin: `${C}px ${C}px` }}>
          {prizes.map((p, i) => {
            const a0 = i * seg;
            const a1 = (i + 1) * seg;
            const mid = a0 + seg / 2;
            const [tx, ty] = polar(mid, R * 0.64);
            return (
              <g key={p.id}>
                <path d={segmentPath(a0, a1)} fill={p.color} stroke="#0B0B0F" strokeWidth="2" />
                <text
                  x={tx}
                  y={ty}
                  fill={ink(p.color)}
                  fontSize={prizes.length > 10 ? 14 : 16}
                  fontWeight={800}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${mid <= 180 ? mid - 90 : mid + 90} ${tx} ${ty})`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {short(p)}
                </text>
              </g>
            );
          })}
        </g>
        {Array.from({ length: prizes.length }, (_, i) => {
          const [x, y] = polar(i * seg, R + 4);
          return <circle key={i} cx={x} cy={y} r={3} fill="#C6FF00" />;
        })}
        <circle cx={C} cy={C} r={44} fill="#0B0B0F" stroke="#C6FF00" strokeWidth="3" />
        <path
          d={`M ${C - 14} ${C - 6} L ${C} ${C - 22} L ${C + 14} ${C - 6} L ${C + 8} ${C - 6} L ${C + 8} ${C + 16} L ${C - 8} ${C + 16} L ${C - 8} ${C - 6} Z`}
          fill="#C6FF00"
        />
      </svg>
      {/* Указатель */}
      <svg
        viewBox="0 0 40 48"
        className="absolute left-1/2 top-0 h-12 w-10 -translate-x-1/2 -translate-y-2 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]"
        aria-hidden="true"
      >
        <path d="M4 2 H36 L20 44 Z" fill="#C6FF00" stroke="#0B0B0F" strokeWidth="3" />
      </svg>
    </div>
  );
}
