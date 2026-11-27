'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useProfileStats } from '@/lib/queries';

/**
 * Статистика профиля: компактные плитки + лучший дроп. От 768 — шесть в ряд. Телефон (< 768): «Лучший дроп» —
 * во всю строку под счётчиками (в трети строки сумма не помещалась и уводила страницу вбок), счётчики до 640 —
 * 3 + 2 (сетка из шести колонок), 640–767 — пять в ряд.
 */
export function StatsRow({ game }: { game: string }) {
  const t = useTranslations();
  const stats = useProfileStats(game);
  if (!stats.data) return <Skeleton className="h-20 w-full" />;
  const s = stats.data;
  const tiles = [
    { label: t('stats.casesOpened'), value: <span className="tabular">{s.casesOpened}</span> },
    {
      label: t('stats.depositsTotal'),
      value: <GemAmount value={s.depositsTotal} size="sm" compact />,
    },
    { label: t('stats.upgradesWon'), value: <span className="tabular">{s.upgradesWon}</span> },
    { label: t('stats.contractsDone'), value: <span className="tabular">{s.contractsDone}</span> },
    { label: t('stats.battlesWon'), value: <span className="tabular">{s.battlesWon}</span> },
  ];
  const best = s.bestDrop?.item;
  return (
    <div className="grid grid-cols-6 gap-2 sm:gap-2.5 sm:max-md:grid-cols-5">
      {tiles.map((tile, i) => (
        <Card
          key={tile.label}
          cut="sm"
          className={cn(
            'flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2.5 sm:px-4 sm:py-3',
            i < 3 ? 'max-sm:col-span-2' : 'max-sm:col-span-3',
          )}
        >
          <div className="font-display text-base font-extrabold sm:text-xl">{tile.value}</div>
          <div className="line-clamp-2 text-[10px] uppercase tracking-wide text-dim sm:text-[11px] sm:tracking-wider">
            {tile.label}
          </div>
        </Card>
      ))}
      {/*
        Сумма видна целиком: колонка текста (flex-1 от нуля) не уже суммы — подписи на её ширину не влияют
        ([contain:inline-size]), — а картинка уступает ей место, только если сумма не помещается (от 768, где
        карточка — шестая часть строки, при больших ценах). Когда помещается, картинка 56 и подписи — как были.
      */}
      <Card
        cut="sm"
        className="flex min-w-0 items-center gap-2.5 px-3 py-2.5 max-md:col-span-full"
        style={
          best
            ? {
                background: `radial-gradient(80% 120% at 0% 50%, ${best.rarity.color}26, transparent 70%)`,
              }
            : undefined
        }
      >
        {best?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={best.imageUrl} alt="" className="h-9 w-14 min-w-0 object-contain" />
        )}
        <div className="flex-1">
          <div className="truncate text-[10px] uppercase tracking-wider text-dim [contain:inline-size] sm:text-[11px]">
            {t('stats.bestDrop')}
          </div>
          {best ? (
            <>
              <div
                className="truncate text-xs font-semibold [contain:inline-size]"
                style={{ color: best.rarity.color }}
              >
                {best.skinName}
              </div>
              <GemAmount value={best.price} size="xs" className="text-accent" />
            </>
          ) : (
            <div className="text-xs text-dim">—</div>
          )}
        </div>
      </Card>
    </div>
  );
}
