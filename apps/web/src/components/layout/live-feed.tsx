'use client';

import { WS_EVENTS, WS_ROOMS, formatGems, type FeedDropDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useGameCode } from '@/lib/game';
import { useRoom, useSocketEvent } from '@/lib/socket';

const MAX = 24;

/** Лента live-дропов: последние дропы игры (REST) + новые по WebSocket. Клик — профиль игрока. */
export function LiveFeedBar() {
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
    <div className="relative h-[var(--feed-h)] border-b border-line bg-surface-1/70">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-3 sm:px-5">
        <div className="flex shrink-0 items-center gap-2 font-display text-xs font-extrabold uppercase tracking-widest text-accent">
          <span className="h-2 w-2 bg-accent animate-pulse-dot" aria-hidden="true" />
          {t('title')}
        </div>
        <div
          className="no-scrollbar flex h-full flex-1 items-center gap-1.5 overflow-x-auto py-1.5"
          aria-label={t('title')}
        >
          {drops.length === 0 && <span className="truncate text-xs text-dim">{t('empty')}</span>}
          {drops.map((d) => (
            <Link
              key={d.id}
              href={`/${d.game}/u/${d.user.shortId}`}
              className={`group relative flex h-full w-[84px] shrink-0 flex-col items-center justify-center overflow-hidden bg-surface-2 sm:w-[108px] ${d.id === fresh ? 'animate-feed-in' : ''}`}
              style={{
                background: `radial-gradient(90% 80% at 50% 100%, ${d.item.rarityColor}40, var(--color-surface-2) 70%)`,
              }}
              title={`${d.user.nickname} · ${d.item.skinName} · ${formatGems(d.item.price)}`}
            >
              {d.item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.item.imageUrl}
                  alt=""
                  className="h-7 w-14 object-contain sm:h-9 sm:w-20"
                  loading="lazy"
                />
              )}
              <span className="mt-0.5 hidden w-full truncate px-1.5 text-center text-[10px] text-muted sm:block">
                {d.item.skinName}
              </span>
              <span
                className="absolute inset-x-0 bottom-0 h-[2px]"
                style={{ background: d.item.rarityColor }}
              />
              <span className="absolute inset-0 hidden items-center justify-center bg-bg/85 px-1 text-center text-[10px] font-semibold text-text group-hover:flex">
                {d.user.nickname}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
