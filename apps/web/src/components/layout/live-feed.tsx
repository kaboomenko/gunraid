'use client';

import { WS_EVENTS, WS_ROOMS, formatGems, type FeedDropDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { OnlineFrame } from './online';

const MAX = 24;

/**
 * Карточка дропа 240×150 (макет): картинка скина 200×100, под ней через 12 — название
 * (Medium 18, 14 от нижнего края), внизу по центру полоса редкости 140×2.
 * Свечение — два размытых эллипса цвета редкости: 192×138 (blur 100 в Figma → 50px в CSS)
 * и 240×88, уходящий на 44 ниже карточки (blur 60 → 30px).
 * При наведении вместо скина — кейс, из которого он выпал, и ник игрока.
 */
function DropCard({ drop, fresh }: { drop: FeedDropDto; fresh: boolean }) {
  const t = useTranslations('topBar');
  const hoverImage = drop.caseImage;
  const hoverTitle = drop.caseName
    ? t('dropFrom', { name: drop.caseName })
    : t(`sources.${drop.source}`);
  return (
    <Link
      href={`/${drop.game}/u/${drop.user.shortId}`}
      className={cn(
        'drop-card group relative h-[150px] w-[240px] shrink-0 overflow-hidden rounded-[12px] bg-surface-1',
        fresh && 'animate-feed-in',
      )}
      style={{ '--rc': drop.item.rarityColor } as CSSProperties}
      title={`${drop.user.nickname} · ${drop.item.skinName} · ${formatGems(drop.item.price)}${hoverTitle ? ` · ${hoverTitle}` : ''}`}
    >
      <span className="drop-card__glow-a" aria-hidden="true" />
      <span className="drop-card__glow-b" aria-hidden="true" />
      <span className="drop-card__brush" aria-hidden="true" />
      <span className="absolute left-5 top-[11.4px] h-[100px] w-[200px]">
        {drop.item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drop.item.imageUrl}
            alt=""
            className={cn(
              'h-full w-full object-contain transition-opacity duration-200',
              hoverImage && 'group-hover:opacity-0 group-focus-visible:opacity-0',
            )}
            loading="lazy"
            draggable={false}
          />
        )}
        {hoverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hoverImage}
            alt=""
            className="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            loading="lazy"
            draggable={false}
          />
        )}
      </span>
      <span className="absolute inset-x-4 bottom-[14px] text-center text-[18px] font-medium">
        <span className="block truncate group-hover:hidden group-focus-visible:hidden">
          {drop.item.skinName}
        </span>
        <span className="hidden truncate group-hover:block group-focus-visible:block">
          {drop.user.nickname}
        </span>
      </span>
      <span
        className="absolute bottom-0 left-1/2 h-[2px] w-[140px] -translate-x-1/2 rounded-[2px]"
        style={{ background: drop.item.rarityColor }}
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Лента последних дропов игры (REST + новые по WebSocket). Уходит до правого края экрана;
 * справа — затемнение 165×150 (#121117 0% → 100%) и плашка онлайна в 48px от края.
 */
export function LiveFeed() {
  const t = useTranslations('feed');
  const game = useGameCode();
  const [drops, setDrops] = useState<FeedDropDto[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<FeedDropDto[]>(`/games/${game}/feed`)
      .then((d) => alive && setDrops(d.slice(0, MAX)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game]);

  useRoom(WS_ROOMS.feed(game));
  useSocketEvent<FeedDropDto>(WS_EVENTS.feedDrop, (d) => {
    if (d.game !== game) return;
    setFresh(d.id);
    setDrops((prev) => [d, ...prev.filter((x) => x.id !== d.id)].slice(0, MAX));
  });

  return (
    <section className="relative h-[150px] min-w-0 flex-1" aria-label={t('title')}>
      <div className="no-scrollbar flex h-full gap-[6px] overflow-x-auto overflow-y-hidden">
        {drops.length === 0 && (
          <div className="flex h-full w-full items-center rounded-[12px] bg-surface-1 px-6 text-[18px] font-medium text-white/40">
            {t('empty')}
          </div>
        )}
        {drops.map((d) => (
          <DropCard key={d.id} drop={d} fresh={d.id === fresh} />
        ))}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[165px] bg-[linear-gradient(90deg,rgb(18_17_23/0),#121117)] md:block"
        aria-hidden="true"
      />
      <OnlineFrame className="absolute right-12 top-1/2 hidden -translate-y-1/2 md:flex" />
    </section>
  );
}
