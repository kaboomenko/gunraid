import {
  Gift,
  LayoutGrid,
  Layers,
  Swords,
  Ticket,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

const MODES: Array<{
  key: 'cases' | 'upgrade' | 'contract' | 'battles' | 'wheel' | 'promo';
  path: string;
  icon: LucideIcon;
}> = [
  { key: 'cases', path: '#cases', icon: LayoutGrid },
  { key: 'upgrade', path: '/upgrade', icon: TrendingUp },
  { key: 'contract', path: '/contract', icon: Layers },
  { key: 'battles', path: '/battles', icon: Swords },
  { key: 'wheel', path: '/bonuses', icon: Gift },
  { key: 'promo', path: '/bonuses', icon: Ticket },
];

export async function ModeGrid({ game }: { game: string }) {
  const t = await getTranslations('modes');
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
      {MODES.map((m) => (
        <Link
          key={m.key}
          href={m.path.startsWith('#') ? m.path : `/${game}${m.path}`}
          className="cut group flex items-center gap-3 p-3.5 transition duration-150 hover:-translate-y-0.5 hover:[--cut-border:rgb(198_255_0/0.5)] sm:p-4"
        >
          <span className="clip-cut grid h-10 w-10 shrink-0 place-items-center bg-accent-soft text-accent transition group-hover:bg-accent group-hover:text-accent-ink [--cut:6px]">
            <m.icon size={20} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-bold uppercase tracking-wide">
              {t(`${m.key}.title`)}
            </span>
            <span className="line-clamp-2 block text-xs text-dim">{t(`${m.key}.text`)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
