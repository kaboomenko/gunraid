'use client';

import { WS_EVENTS, type SiteStatsDto, type StatsUpdatePayload } from '@gunraid/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { OnlineIcon } from '@/components/icons/design-icons';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { MD_UP, useMediaQuery } from '@/lib/media';
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
 * между иконкой и текстом 24, между числом и словом 6; заливка лайм 20%, размытие фона 20, скругление 12.
 * Телефон (< 768, макет 36.png): плитка 58×60 #181821 слева от ленты, скругления 6; иконка 24, число
 * DemiBold 12 и «онлайн» DemiBold 8 капителью — колонкой по центру, зазоры 3. Цифры пропорциональные,
 * четырёхзначное число слитно («2571», как в макете и в гемах); от 768 — как было («2 571», равноширинные).
 */
export function OnlineFrame({ className }: { className?: string }) {
  const t = useTranslations('topBar');
  const format = useFormatter();
  const online = useOnline();
  // число приходит только после ответа /stats — к этому времени ширина окна уже известна
  const wide = useMediaQuery(MD_UP);
  return (
    <div
      className={cn(
        // телефон: плитка 58×60, содержимое колонкой по центру
        'flex h-[60px] w-[58px] flex-col items-center justify-center gap-[3px] rounded-[6px] bg-surface-1 text-lime max-md:shrink-0',
        // от 768 — прежняя плашка: лайм 20% + размытие, отступы 24/24/24 и 36, скругление 12
        'md:h-auto md:w-auto md:flex-row md:justify-normal md:gap-6 md:rounded-[12px] md:bg-lime/20 md:py-6 md:pl-6 md:pr-9 md:backdrop-blur-[10px]',
        className,
      )}
      data-testid="online"
      role="status"
      aria-label={online === null ? t('online') : t('onlineLabel', { count: online })}
    >
      <OnlineIcon size={48} className="size-6 md:size-12" />
      <div className="flex flex-col gap-[3px] max-md:items-center md:gap-[6px]" aria-hidden="true">
        <span className="text-[12px] font-semibold md:text-[24px] md:tabular-nums">
          {online === null
            ? '—'
            : format.number(online, wide ? undefined : { useGrouping: 'min2' })}
        </span>
        {/* min-w 34 — бокс Figma (33,25 → 34): слово начинается с x 24, как в макете */}
        <span className="text-[8px] font-semibold text-lime/30 [font-variant-caps:all-small-caps] max-md:min-w-[34px] md:text-[16px]">
          {t('online')}
        </span>
      </div>
    </div>
  );
}
