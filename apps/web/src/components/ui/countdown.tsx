'use client';

import { useEffect, useState } from 'react';

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Обратный отсчёт до момента (кулдауны, лобби, лидерборды). */
export function Countdown({ to, onDone, className }: { to: string | number | Date; onDone?: () => void; className?: string }) {
  const target = new Date(to).getTime();
  const [left, setLeft] = useState(() => target - Date.now());
  useEffect(() => {
    setLeft(target - Date.now());
    const id = setInterval(() => {
      const next = target - Date.now();
      setLeft(next);
      if (next <= 0) {
        clearInterval(id);
        onDone?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, onDone]);
  return (
    <span className={className} suppressHydrationWarning>
      {format(left)}
    </span>
  );
}
