import { formatGems, type SiteStatsDto } from '@gunraid/shared';
import { getTranslations } from 'next-intl/server';

export async function StatsStrip({ stats }: { stats: SiteStatsDto | null }) {
  const t = await getTranslations('home');
  const cases = stats?.casesOpened ?? 0;
  const users = stats?.users ?? 0;
  const online = Math.max(stats?.online ?? 0, 1);
  const items = [
    { label: t('statsCases', { count: cases }), value: cases },
    { label: t('statsUsers', { count: users }), value: users },
    { label: t('statsOnline'), value: online },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {items.map((i) => (
        <div key={i.label} className="cut cut-sm px-3 py-3 text-center sm:py-4">
          <div className="font-display text-lg font-extrabold text-accent tabular sm:text-2xl">{formatGems(i.value)}</div>
          <div className="text-[11px] uppercase tracking-wider text-dim sm:text-xs">{i.label}</div>
        </div>
      ))}
    </div>
  );
}
