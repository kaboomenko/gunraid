'use client';

import { useEffect, useRef } from 'react';
import { startSnow } from '@/lib/snow';

/**
 * Падающий снег промо-полосы: частицы на Canvas 2D (lib/snow.ts). Холст лежит над сугробом
 * (.promo-strip::before) и под текстом и кнопкой; первый кадр плавно проявляется.
 */
export function PromoSnow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return startSnow(canvas, { onReady: () => canvas.classList.add('is-ready') });
  }, []);

  return <canvas ref={ref} className="promo-snow" aria-hidden="true" data-testid="promo-snow" />;
}
