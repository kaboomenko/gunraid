'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  BattleIcon,
  CargoIcon,
  CaseIcon,
  ContractIcon,
  LoginIcon,
  UpgradeIcon,
} from '@/components/icons/design-icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useGameCode } from '@/lib/game';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';
import { BalancePill } from './balance';
import { GameSwitcher } from './game-switcher';
import { isActive } from './nav-items';
import { NotificationsBell } from './notifications-bell';
import { UserMenu } from './user-menu';

/** Пункты главного меню: четыре из макета и «Грузы» (иконка 24 + текст DemiBold 24). */
const DESKTOP_NAV: Array<{
  key: 'cases' | 'upgrade' | 'contract' | 'battles' | 'cargo';
  path: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: 'cases', path: '', icon: CaseIcon },
  { key: 'upgrade', path: '/upgrade', icon: UpgradeIcon },
  { key: 'contract', path: '/contract', icon: ContractIcon },
  { key: 'battles', path: '/battles', icon: BattleIcon },
  { key: 'cargo', path: '/cargo', icon: CargoIcon },
];

/**
 * Шапка. Десктоп (от 1024px) — плашка #181821 высотой 120 со скруглением 24, поля 36 слева и 24
 * с остальных сторон: логотип слева (высотой 64, ниже 1536px — 48), справа «Вход» (или баланс и
 * профиль), между ними — меню из пяти пунктов (иконка 24 + текст DemiBold 24, внутри пункта 12).
 * Плашка — сетка «1fr auto 1fr»: меню всегда ровно по центру шапки, а если правый блок шире своей
 * колонки (большой баланс), сетка сдвигает меню влево, и оно не наезжает ни на логотип, ни на кнопки.
 * Подписи меню — от 1720px; ниже остаются иконки с подсказкой (title). Между пунктами: ниже 1280px —
 * 24, 1280–1719 — 48, 1720–1879 — 32, от 1880 — 48. Телефон и планшет — компактная липкая шапка
 * (макета пока нет).
 */
export function SiteHeader() {
  const t = useTranslations();
  const game = useGameCode();
  const pathname = usePathname();
  const me = useMe();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);

  return (
    <>
      <header className="hidden px-6 pt-[6px] lg:block">
        {/* Поля 24 с обеих сторон (сетка симметрична — меню по центру шапки), логотипу ещё 12 слева: всего 36. */}
        <div className="grid h-[120px] grid-cols-[1fr_auto_1fr] items-center gap-6 rounded-b-[36px] rounded-t-[12px] bg-surface-1 p-6">
          <Link
            href={`/${game}`}
            className="ml-3 flex items-center justify-self-start text-lime"
            aria-label={t('brand.name')}
          >
            <span className="logo-mask h-12 2xl:h-16" />
          </Link>
          {/* 1880px — в rem, как стандартные брейкпоинты: иначе правило встанет раньше 3xl и проиграет ему. */}
          <nav
            className="flex items-center gap-6 xl:gap-12 3xl:gap-8 min-[117.5rem]:gap-12"
            aria-label={t('nav.home')}
          >
            {DESKTOP_NAV.map((item) => {
              const active = isActive(pathname, game, item.path);
              return (
                <Link
                  key={item.key}
                  href={`/${game}${item.path}`}
                  className={cn(
                    'flex items-center gap-3 text-[24px] font-semibold transition-colors',
                    active ? 'text-white' : 'text-white/50 hover:text-white/80',
                  )}
                  aria-current={active ? 'page' : undefined}
                  title={t(`nav.${item.key}`)}
                >
                  <item.icon />
                  <span className="sr-only 3xl:not-sr-only">{t(`nav.${item.key}`)}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center justify-end gap-[6px] justify-self-end">
            {me.isLoading ? (
              <Skeleton className="h-[72px] w-[167px] rounded-[12px]" />
            ) : me.data ? (
              <>
                <BalancePill balance={me.data.balance} large />
                <button
                  type="button"
                  className="grid h-[72px] w-[72px] place-items-center rounded-[12px] bg-lime text-accent-ink transition hover:brightness-110"
                  onClick={openDeposit}
                  aria-label={t('gems.deposit')}
                  data-testid="deposit-open"
                >
                  <Plus size={28} strokeWidth={3} />
                </button>
                <NotificationsBell large />
                <UserMenu me={me.data} large />
              </>
            ) : (
              <button
                type="button"
                className="flex h-[72px] items-center gap-6 rounded-[12px] bg-lime pl-6 pr-9 text-[24px] font-semibold text-accent-ink transition hover:brightness-110"
                onClick={openLogin}
                data-testid="login-button"
              >
                <LoginIcon />
                {t('header.login')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* На телефоне шапка идёт первой (order-first), над промо-полосой и лентой. */}
      <header className="sticky top-0 z-40 order-first h-[var(--header-h)] border-b border-line bg-bg/85 backdrop-blur-md lg:hidden">
        <div className="flex h-full items-center gap-1.5 px-3 sm:gap-3 sm:px-5">
          <Link
            href={`/${game}`}
            className="flex shrink-0 items-center text-lime"
            aria-label={t('brand.name')}
          >
            <span className="logo-mask hidden h-7 sm:inline-block" />
            {/* На узком экране — эмблема: полный логотип вместе с балансом не помещается в 360px. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/emblem.svg" alt="" className="h-8 w-auto sm:hidden" />
          </Link>
          <GameSwitcher />
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
            {me.isLoading ? (
              <Skeleton className="h-10 w-28" />
            ) : me.data ? (
              <>
                <div className="flex items-center">
                  <BalancePill balance={me.data.balance} />
                  <Button
                    size="icon"
                    className="ml-1 h-10 w-9 sm:w-10"
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
    </>
  );
}
