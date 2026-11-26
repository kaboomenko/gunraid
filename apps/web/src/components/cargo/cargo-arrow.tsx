'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ArrowRightIcon } from '@/components/icons/design-icons';
import { cn } from '@/lib/cn';

/**
 * Стрелка, нажатая с клавиатуры: при переходе страница груза монтируется заново, и фокус падал на
 * <body>. Запоминаем сторону — стрелка нового груза забирает фокус, и листать можно Enter подряд
 * (так же, как стрелки страницы кейса).
 */
let keyboardArrow: 'prev' | 'next' | null = null;

/**
 * Стрелка соседнего груза — вид .case-arrow (72×72, скругление 12, #26262F, иконка белая 30%);
 * переход без прокрутки страницы, соседняя страница загружается заранее.
 */
export function CargoArrow({
  href,
  side,
  label,
}: {
  href: string;
  side: 'prev' | 'next';
  label: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (keyboardArrow !== side) return;
    keyboardArrow = null;
    ref.current?.focus({ preventScroll: true });
  }, [side]);
  return (
    <Link
      ref={ref}
      href={href}
      scroll={false}
      prefetch
      className={cn('case-arrow cargo-arrow', `cargo-arrow--${side}`)}
      aria-label={label}
      title={label}
      // detail === 0 — нажатие с клавиатуры (Enter), а не мышью.
      onClick={(e) => {
        keyboardArrow = e.detail === 0 ? side : null;
      }}
      data-testid={`cargo-arrow-${side}`}
    >
      <ArrowRightIcon className={side === 'prev' ? '-scale-x-100' : undefined} />
    </Link>
  );
}
