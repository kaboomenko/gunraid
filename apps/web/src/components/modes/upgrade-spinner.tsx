'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const R = 104;
const C = 2 * Math.PI * R;

/**
 * Круговой спиннер апгрейда: лаймовая дуга = шанс (от верха по часовой),
 * стрелка останавливается на броске сервера (roll / 1e6 оборота). Победа ⇔ стрелка в дуге.
 */
export function UpgradeSpinner({
  chance,
  roll,
  spinId,
  fast,
  result,
  onDone,
  children,
}: {
  /** 0..1 */
  chance: number;
  /** 0..1 — бросок сервера; null до запуска. */
  roll: number | null;
  spinId: number;
  fast: boolean;
  result: 'win' | 'lose' | null;
  onDone?: () => void;
  children?: React.ReactNode;
}) {
  const pointer = useRef<SVGGElement>(null);
  const [angle, setAngle] = useState(0);
  const base = useRef(0);

  useEffect(() => {
    if (roll === null) return;
    const target = base.current + 360 * 5 + roll * 360 - (base.current % 360);
    base.current = target;
    const el = pointer.current;
    if (!el) return;
    if (fast) {
      el.style.transition = 'none';
      setAngle(target);
      const id = setTimeout(() => onDone?.(), 30);
      return () => clearTimeout(id);
    }
    el.style.transition = 'transform 4.6s cubic-bezier(0.1, 0.65, 0.12, 1)';
    setAngle(target);
    const id = setTimeout(() => onDone?.(), 4700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId]);

  const arc = Math.max(0, Math.min(1, chance)) * C;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[300px]">
      <svg viewBox="0 0 240 240" className="h-full w-full">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx="120"
          cy="120"
          r={R}
          fill="none"
          stroke="var(--color-surface-3)"
          strokeWidth="14"
        />
        <circle
          cx="120"
          cy="120"
          r={R}
          fill="none"
          stroke={result === 'lose' ? 'var(--color-danger)' : 'var(--color-accent)'}
          strokeWidth="14"
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(-90 120 120)"
          filter="url(#glow)"
          className="transition-[stroke-dasharray] duration-300"
        />
        {Array.from({ length: 40 }, (_, i) => (
          <line
            key={i}
            x1="120"
            y1="6"
            x2="120"
            y2={i % 5 === 0 ? 14 : 10}
            stroke="var(--color-line-strong)"
            strokeWidth="2"
            transform={`rotate(${i * 9} 120 120)`}
          />
        ))}
        <g
          ref={pointer}
          style={{ transform: `rotate(${angle}deg)`, transformOrigin: '120px 120px' }}
        >
          <polygon points="120,22 112,6 128,6" fill="#fff" />
          <line x1="120" y1="24" x2="120" y2="44" stroke="#fff" strokeWidth="3" />
        </g>
      </svg>
      <div
        className={cn(
          'absolute inset-[22%] grid place-items-center text-center',
          result === 'win' && 'text-accent',
          result === 'lose' && 'text-danger',
        )}
      >
        {children}
      </div>
    </div>
  );
}
