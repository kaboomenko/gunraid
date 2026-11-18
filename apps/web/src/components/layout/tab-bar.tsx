'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { TAB_BAR, isActive } from './nav-items';

/** Нижний таб-бар на телефоне. */
export function MobileTabBar() {
  const t = useTranslations('nav');
  const game = useGameCode();
  const pathname = usePathname();
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur-md md:hidden"
      aria-label={t('home')}
    >
      <div className="grid h-[var(--tabbar-h)] grid-cols-5">
        {TAB_BAR.map((item) => {
          const active = isActive(pathname, game, item.path);
          return (
            <Link
              key={item.key}
              href={`/${game}${item.path}`}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition',
                active ? 'text-accent' : 'text-dim',
              )}
            >
              {active && <span className="absolute inset-x-5 top-0 h-0.5 bg-accent" />}
              <item.icon size={20} strokeWidth={active ? 2.4 : 2} />
              {t(item.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
