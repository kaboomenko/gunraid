'use client';

import { WS_EVENTS, type SiteStatsDto, type StatsUpdatePayload } from '@gunraid/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { OnlineIcon } from '@/components/icons/design-icons';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSocketEvent } from '@/lib/socket';
import { useUi } from '@/lib/store';

/** Онлайн: начальное значение — REST, дальше — WebSocket. */
function useOnline(): number | null {
  const online = useUi((s) => s.online);
  const setOnline = useUi((s) => s.setOnline);

  useEffect(() => {
    void api
      .get<SiteStatsDto>('/stats')
      .then((s) => setOnline(Math.max(1, s.online)))
      .catch(() => undefined);
  }, [setOnline]);

  useSocketEvent<StatsUpdatePayload>(WS_EVENTS.statsUpdate, (p) =>
    setOnline(Math.max(1, p.online)),
  );
  return online;
}

/**
 * Плашка онлайна у правого края ленты дропов (макет): иконка 48, отступы 24/24/24 и 36 справа,
 * между иконкой и текстом 24, между числом и словом 6; заливка лайм 20%, размытие фона 20, скругление 6.
 */
export function OnlineFrame({ className }: { className?: string }) {
  const t = useTranslations('topBar');
  const format = useFormatter();
  const online = useOnline();
  return (
    <div
      className={cn(
        'flex items-center gap-6 rounded-[6px] bg-lime/20 py-6 pl-6 pr-9 text-lime backdrop-blur-[10px]',
        className,
      )}
      data-testid="online"
      role="status"
      aria-label={online === null ? t('online') : t('onlineLabel', { count: online })}
    >
      <OnlineIcon size={48} />
      <div className="flex flex-col gap-[6px]" aria-hidden="true">
        <span className="tabular text-[24px] font-semibold">
          {online === null ? '—' : format.number(online)}
        </span>
        <span className="text-[16px] font-semibold text-lime/30 [font-variant-caps:all-small-caps]">
          {t('online')}
        </span>
      </div>
    </div>
  );
}
