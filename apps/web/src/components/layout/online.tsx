'use client';

import { WS_EVENTS, type SiteStatsDto, type StatsUpdatePayload } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSocketEvent } from '@/lib/socket';
import { useUi } from '@/lib/store';

/** Счётчик онлайна: начальное значение — REST, дальше — WebSocket. */
export function OnlineBadge({ className }: { className?: string }) {
  const t = useTranslations('header');
  const online = useUi((s) => s.online);
  const setOnline = useUi((s) => s.setOnline);

  useEffect(() => {
    void api
      .get<SiteStatsDto>('/stats')
      .then((s) => setOnline(Math.max(1, s.online)))
      .catch(() => undefined);
  }, [setOnline]);

  useSocketEvent<StatsUpdatePayload>(WS_EVENTS.statsUpdate, (p) => setOnline(Math.max(1, p.online)));

  return (
    <div className={cn('items-center gap-2 text-xs text-muted', className)} data-testid="online">
      <span className="relative h-2 w-2 bg-accent animate-pulse-dot" aria-hidden="true" />
      <span className="tabular">{online === null ? '—' : t('online', { count: online })}</span>
    </div>
  );
}
