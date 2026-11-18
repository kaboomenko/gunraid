'use client';

import type { LeaderboardDto, LeaderboardEntryDto, LeaderboardsDto } from '@gunraid/shared';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/me';

const PLACE_COLORS = ['text-accent', 'text-[#D9DDE6]', 'text-[#E0A060]'];

function PlaceBadge({ place }: { place: number }) {
  if (place <= 3) {
    const Icon = place === 1 ? Crown : Medal;
    return <Icon size={18} className={PLACE_COLORS[place - 1]} />;
  }
  return <span className="w-5 text-center font-display text-sm font-bold text-dim">{place}</span>;
}

function Row({ e, game, me }: { e: LeaderboardEntryDto; game: string; me: boolean }) {
  return (
    <li
      className={cn(
        'clip-cut grid grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 [--cut:6px]',
        e.place <= 3 ? 'bg-surface-2' : 'bg-surface-1',
        me && 'ring-1 ring-inset ring-accent',
      )}
    >
      <PlaceBadge place={e.place} />
      <Link
        href={`/${game}/u/${e.user.shortId}`}
        className="flex min-w-0 items-center gap-2 hover:text-accent"
      >
        <Avatar src={e.user.avatarUrl} name={e.user.nickname} size="sm" />
        <span className="truncate font-semibold">{e.user.nickname}</span>
        <span className="hidden text-[11px] text-dim sm:inline">LVL {e.user.level}</span>
      </Link>
      <GemAmount value={e.value} size="sm" />
      <span className="w-20 text-right">
        {e.prize > 0 ? (
          <GemAmount value={e.prize} size="sm" signed className="text-accent" />
        ) : null}
      </span>
    </li>
  );
}

function Board({ board, game }: { board: LeaderboardDto; game: string }) {
  const t = useTranslations('leaderboard');
  const me = useMe();
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <Card className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-xs text-muted">
            {t('endsIn')}{' '}
            <Countdown to={board.periodEnd} className="font-semibold text-text tabular" />
          </span>
          {me.data && board.me && (
            <span className="text-xs text-muted">
              {t('yourPlace')}:{' '}
              <span className="font-semibold text-text">{board.me.place ?? '—'}</span> ·{' '}
              <GemAmount value={board.me.value} size="xs" />
            </span>
          )}
        </div>
        {board.top.length ? (
          <ol className="space-y-1.5" data-testid="leaderboard-top">
            {board.top.map((e) => (
              <Row
                key={e.place}
                e={e}
                game={game}
                me={Boolean(me.data && board.me?.place === e.place)}
              />
            ))}
          </ol>
        ) : (
          <EmptyState icon={<Trophy size={32} />} text={t('empty')} />
        )}
        {me.data && board.me?.place === null && (
          <p className="px-1 text-xs text-dim">{t('notRanked')}</p>
        )}
      </Card>
      <div className="space-y-5">
        <Card className="space-y-2 p-4">
          <h2 className="font-display text-base font-bold uppercase">{t('prizes')}</h2>
          <ul className="space-y-1 text-sm">
            {board.prizes.map((p) => (
              <li key={`${p.from}-${p.to}`} className="flex items-center justify-between gap-2">
                <span className="text-muted">
                  {p.from === p.to
                    ? t('placeOne', { place: p.from })
                    : t('placeRange', { from: p.from, to: p.to })}
                </span>
                <GemAmount value={p.amount} size="sm" className="text-accent" />
              </li>
            ))}
          </ul>
        </Card>
        {board.previous.length > 0 && (
          <Card className="space-y-2 p-4">
            <h2 className="font-display text-base font-bold uppercase">{t('previous')}</h2>
            <ol className="space-y-1.5">
              {board.previous.map((e) => (
                <li key={e.place} className="flex items-center gap-2 text-sm">
                  <PlaceBadge place={e.place} />
                  <span className="min-w-0 flex-1 truncate">{e.user.nickname}</span>
                  <GemAmount value={e.value} size="xs" />
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}

export function LeaderboardView({ game, initial }: { game: string; initial: LeaderboardsDto }) {
  const t = useTranslations('leaderboard');
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const data = useQuery({
    queryKey: ['leaderboards', game],
    queryFn: () => api.get<LeaderboardsDto>(`/games/${game}/leaderboards`),
    placeholderData: initial,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const board = (data.data ?? initial)[period];
  return (
    <Tabs
      value={period}
      onValueChange={(v) => setPeriod(v as 'day' | 'week')}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="day">{t('periods.day')}</TabsTrigger>
        <TabsTrigger value="week">{t('periods.week')}</TabsTrigger>
      </TabsList>
      <TabsContent value={period} className="pt-0">
        {board ? <Board board={board} game={game} /> : <EmptyState text={t('empty')} />}
      </TabsContent>
    </Tabs>
  );
}
