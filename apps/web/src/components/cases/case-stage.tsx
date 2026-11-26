'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, type CSSProperties } from 'react';
import { ArrowRightIcon } from '@/components/icons/design-icons';
import type { CaseNeighbour, CaseNeighbours } from '@/lib/case-page';
import { cn } from '@/lib/cn';

/** Соседний кейс 234×286 (стили — .case-neighbour): название и картинка 186×186, обе 50%. */
function NeighbourCard({
  game,
  side,
  neighbour,
}: {
  game: string;
  side: 'prev' | 'next';
  neighbour: CaseNeighbour;
}) {
  return (
    // Для клавиатуры и скринридеров переход — стрелка рядом; карточка — та же ссылка для мыши.
    <Link
      href={`/${game}/case/${neighbour.slug}`}
      scroll={false}
      prefetch
      className={cn('case-neighbour', `case-neighbour--${side}`)}
      tabIndex={-1}
      aria-hidden="true"
      title={neighbour.name}
      data-testid={`case-neighbour-${side}`}
    >
      <span className="case-neighbour__name truncate">{neighbour.name}</span>
      {neighbour.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={neighbour.imageUrl} alt="" className="case-neighbour__image" draggable={false} />
      ) : (
        <span className="case-neighbour__image" />
      )}
    </Link>
  );
}

/**
 * Стрелка, нажатая с клавиатуры: при переходе страница кейса монтируется заново, и фокус падал на
 * <body>. Запоминаем сторону — стрелка нового кейса забирает фокус, и листать можно Enter подряд.
 */
let keyboardArrow: 'prev' | 'next' | null = null;

function Arrow({
  game,
  side,
  neighbour,
}: {
  game: string;
  side: 'prev' | 'next';
  neighbour: CaseNeighbour;
}) {
  const t = useTranslations('case');
  const ref = useRef<HTMLAnchorElement>(null);
  const label = t(side === 'prev' ? 'prevCase' : 'nextCase', { name: neighbour.name });
  useEffect(() => {
    if (keyboardArrow !== side) return;
    keyboardArrow = null;
    ref.current?.focus({ preventScroll: true });
  }, [side]);
  return (
    <Link
      ref={ref}
      href={`/${game}/case/${neighbour.slug}`}
      scroll={false}
      prefetch
      className={cn('case-arrow', `case-arrow--${side}`)}
      aria-label={label}
      title={label}
      // detail === 0 — нажатие с клавиатуры (Enter), а не мышью.
      onClick={(e) => {
        keyboardArrow = e.detail === 0 ? side : null;
      }}
      data-testid={`case-arrow-${side}`}
    >
      <ArrowRightIcon className={side === 'prev' ? '-scale-x-100' : undefined} />
    </Link>
  );
}

/**
 * Сцена в покое: x1 — кейс 286×286 по центру, стрелки и соседние кейсы (если кейс есть в каталоге
 * главной); x2…x5 — N копий кейса через 48 по центру, стрелок и соседей нет. Размеры и видимость
 * соседей — в CSS (.case-band, container queries по ширине сцены).
 */
export function CaseStageIdle({
  game,
  name,
  imageUrl,
  count,
  neighbours,
}: {
  game: string;
  name: string;
  imageUrl: string | null;
  count: number;
  neighbours: CaseNeighbours | null;
}) {
  return (
    <>
      <div
        className="case-band__row"
        style={{ '--n': count } as CSSProperties}
        data-testid="case-copies"
      >
        {Array.from({ length: count }, (_, i) =>
          imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={imageUrl}
              alt={i === 0 ? name : ''}
              className="case-band__copy"
              draggable={false}
              data-testid="case-copy"
            />
          ) : (
            <span key={i} className="case-band__copy" data-testid="case-copy" />
          ),
        )}
      </div>
      {count === 1 && neighbours ? (
        <>
          <NeighbourCard game={game} side="prev" neighbour={neighbours.prev} />
          <NeighbourCard game={game} side="next" neighbour={neighbours.next} />
          <Arrow game={game} side="prev" neighbour={neighbours.prev} />
          <Arrow game={game} side="next" neighbour={neighbours.next} />
        </>
      ) : null}
    </>
  );
}
