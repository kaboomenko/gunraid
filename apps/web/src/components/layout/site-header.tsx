'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';
import { BalancePill } from './balance';
import { GameSwitcher } from './game-switcher';
import { MAIN_NAV, isActive } from './nav-items';
import { OnlineBadge } from './online';
import { NotificationsBell } from './notifications-bell';
import { UserMenu } from './user-menu';

export function SiteHeader() {
  const t = useTranslations();
  const game = useGameCode();
  const pathname = usePathname();
  const me = useMe();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);

  return (
    <header className="sticky top-0 z-40 h-[var(--header-h)] border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <Link
          href={`/${game}`}
          className="mr-1 flex shrink-0 items-center"
          aria-label={t('brand.name')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt={t('brand.name')} className="hidden h-7 w-auto md:block" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem.svg" alt={t('brand.name')} className="h-8 w-auto md:hidden" />
        </Link>
        <GameSwitcher />
        <nav className="ml-2 hidden items-center lg:flex" aria-label={t('nav.home')}>
          {MAIN_NAV.map((item) => {
            const active = isActive(pathname, game, item.path);
            return (
              <Link
                key={item.key}
                href={`/${game}${item.path}`}
                className={cn(
                  'relative flex h-[var(--header-h)] items-center gap-2 px-3 font-display text-[13px] font-bold uppercase tracking-wide transition',
                  active ? 'text-accent' : 'text-muted hover:text-text',
                )}
              >
                <item.icon size={16} />
                {t(`nav.${item.key}`)}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <OnlineBadge className="hidden xl:flex" />
          {me.isLoading ? (
            <Skeleton className="h-10 w-28" />
          ) : me.data ? (
            <>
              <div className="flex items-center">
                <BalancePill balance={me.data.balance} />
                <Button
                  size="icon"
                  className="ml-1 h-10 w-10"
                  onClick={openDeposit}
                  aria-label={t('gems.deposit')}
                  data-testid="deposit-open"
                >
                  <Plus size={20} strokeWidth={3} />
                </Button>
              </div>
              <NotificationsBell />
              <UserMenu me={me.data} />
            </>
          ) : (
            <Button onClick={openLogin} data-testid="login-button">
              {t('header.login')}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
