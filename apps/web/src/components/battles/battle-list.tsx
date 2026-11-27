'use client';

import {
  BATTLE_FORMATS,
  BATTLE_MODES,
  WS_EVENTS,
  type BattleFormatCode,
  type BattleListDto,
  type BattleListItemDto,
  type BattleModeCode,
} from '@gunraid/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Swords } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/me';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { BattleCard } from './battle-card';

type Tab = 'active' | 'finished' | 'mine';
type Filter<T> = T | 'all';

const ACTIVE_PAGE = 50;

function qs(params: Record<string, string | number | undefined>) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== 'all')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function sortActive(list: BattleListItemDto[]): BattleListItemDto[] {
  return [...list].sort((a, b) => {
    const wa = a.status === 'waiting' ? 0 : 1;
    const wb = b.status === 'waiting' ? 0 : 1;
    return wa - wb || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/** Список баттлов: активные обновляются в реальном времени (комната battles:<игра>). */
export function BattleList({ game, initial }: { game: string; initial: BattleListDto }) {
  const t = useTranslations('battles');
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('active');
  const [format, setFormat] = useState<Filter<BattleFormatCode>>('all');
  const [mode, setMode] = useState<Filter<BattleModeCode>>('all');

  const activeKey = ['battles', game, 'active', format, mode] as const;
  const active = useQuery({
    queryKey: activeKey,
    enabled: tab === 'active',
    initialData: format === 'all' && mode === 'all' ? initial : undefined,
    staleTime: 10_000,
    queryFn: () =>
      api.get<BattleListDto>(
        `/games/${game}/battles?${qs({ status: 'active', format, mode, pageSize: ACTIVE_PAGE })}`,
      ),
  });

  const history = useInfiniteQuery({
    queryKey: ['battles-history', game, tab, format, mode],
    enabled: tab !== 'active' && (tab !== 'mine' || Boolean(me.data)),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<BattleListDto>(
        `/games/${game}/battles?${qs({
          status: 'finished',
          mine: tab === 'mine' ? '1' : undefined,
          format,
          mode,
          page: pageParam,
          pageSize: 20,
        })}`,
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });

  useRoom(`battles:${game}`);
  const matches = (b: BattleListItemDto, f: Filter<BattleFormatCode>, m: Filter<BattleModeCode>) =>
    (f === 'all' || b.format === f) && (m === 'all' || b.mode === m);

  useSocketEvent<BattleListItemDto>(WS_EVENTS.battlesUpsert, (item) => {
    if (item.game !== game) return;
    for (const [key, data] of qc.getQueriesData<BattleListDto>({
      queryKey: ['battles', game, 'active'],
    })) {
      if (!data) continue;
      const [, , , f, m] = key as unknown as [
        string,
        string,
        string,
        Filter<BattleFormatCode>,
        Filter<BattleModeCode>,
      ];
      const rest = data.items.filter((b) => b.id !== item.id);
      const isActive = item.status === 'waiting' || item.status === 'in_progress';
      const items = isActive && matches(item, f, m) ? sortActive([item, ...rest]) : rest;
      qc.setQueryData<BattleListDto>(key, {
        ...data,
        items,
        total: data.total + (items.length - data.items.length),
      });
    }
    if (item.status === 'finished') {
      void qc.invalidateQueries({ queryKey: ['battles-history', game] });
    }
  });

  useSocketEvent<{ id: string }>(WS_EVENTS.battlesRemove, ({ id }) => {
    for (const [key, data] of qc.getQueriesData<BattleListDto>({
      queryKey: ['battles', game, 'active'],
    })) {
      if (!data) continue;
      const items = data.items.filter((b) => b.id !== id);
      if (items.length !== data.items.length) {
        qc.setQueryData<BattleListDto>(key, { ...data, items, total: data.total - 1 });
      }
    }
  });

  const list =
    tab === 'active'
      ? (active.data?.items ?? [])
      : (history.data?.pages.flatMap((p) => p.items) ?? []);
  const loading =
    tab === 'active' ? active.isPending : history.isPending && history.fetchStatus !== 'idle';
  const meId = me.data?.id ?? null;

  const chip = (selected: boolean) =>
    cn(
      'clip-cut h-8 px-3 text-xs font-bold uppercase transition [--cut:5px]',
      selected ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
    );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <TabsList>
            <TabsTrigger value="active">{t('tabs.active')}</TabsTrigger>
            <TabsTrigger value="finished">{t('tabs.finished')}</TabsTrigger>
            {me.data && <TabsTrigger value="mine">{t('tabs.mine')}</TabsTrigger>}
          </TabsList>
        </div>
        {/*
          Ряд форматов прокручивается и в поле страницы: до 768 поле 12 (-mx-3 — ровно до края экрана), с 768
          поле 24 (ряд заходит в него на 20), с 1024 — по ширине контента. Порог md, а не sm: на 640–767 поле
          тоже 12, и -mx-5 прокручивал страницу вбок.
        */}
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 md:-mx-5 md:px-5 lg:mx-0 lg:px-0">
          <button type="button" className={chip(format === 'all')} onClick={() => setFormat('all')}>
            {t('all')}
          </button>
          {BATTLE_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              className={chip(format === f)}
              onClick={() => setFormat(f)}
            >
              {t(`formatsShort.${f}`)}
            </button>
          ))}
          <span className="mx-1 w-px shrink-0 bg-line" />
          <button type="button" className={chip(mode === 'all')} onClick={() => setMode('all')}>
            {t('all')}
          </button>
          {BATTLE_MODES.map((m) => (
            <button key={m} type="button" className={chip(mode === m)} onClick={() => setMode(m)}>
              {t(`modes.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <TabsContent value={tab} className="space-y-4 pt-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton clip-cut h-20" />
            ))}
          </div>
        ) : list.length ? (
          <div className="space-y-2" data-testid="battle-list">
            {list.map((b) => (
              <BattleCard key={b.id} battle={b} meId={meId} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Swords size={32} />}
            text={
              tab === 'active' ? t('empty') : tab === 'mine' ? t('emptyMine') : t('emptyFinished')
            }
          />
        )}
        {tab !== 'active' && history.hasNextPage && (
          <Button
            variant="ghost"
            block
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        )}
      </TabsContent>
    </Tabs>
  );
}
