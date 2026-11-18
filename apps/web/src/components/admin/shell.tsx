'use client';

import {
  ArrowUpFromLine,
  Boxes,
  Gift,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/me';

const NAV: Array<{
  key: string;
  href: string;
  icon: LucideIcon;
  roles: Array<'admin' | 'support'>;
}> = [
  { key: 'dashboard', href: '/admin', icon: LayoutDashboard, roles: ['admin'] },
  { key: 'users', href: '/admin/users', icon: Users, roles: ['admin', 'support'] },
  {
    key: 'withdrawals',
    href: '/admin/withdrawals',
    icon: ArrowUpFromLine,
    roles: ['admin', 'support'],
  },
  { key: 'deposits', href: '/admin/deposits', icon: Wallet, roles: ['admin'] },
  { key: 'cases', href: '/admin/cases', icon: Package, roles: ['admin'] },
  { key: 'catalog', href: '/admin/catalog', icon: Boxes, roles: ['admin'] },
  { key: 'bonuses', href: '/admin/bonuses', icon: Gift, roles: ['admin'] },
  { key: 'settings', href: '/admin/settings', icon: Settings, roles: ['admin'] },
  { key: 'audit', href: '/admin/audit', icon: ScrollText, roles: ['admin'] },
];

/** Оболочка админки: навигация по ролям; API всё равно проверяет роль на каждом запросе. */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  const me = useMe();
  const pathname = usePathname();
  if (me.isLoading) return <Skeleton className="h-64 w-full" />;
  const role = me.data?.role;
  if (role !== 'admin' && role !== 'support') {
    return (
      <EmptyState icon={<ShieldAlert size={36} />} title={t('denied')} text={t('deniedText')} />
    );
  }
  const items = NAV.filter((n) => n.roles.includes(role));
  return (
    <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start">
      <nav
        className="cut no-scrollbar flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-[calc(var(--header-h)+var(--feed-h)+16px)] lg:flex-col"
        aria-label={t('title')}
      >
        <div className="hidden px-3 pb-2 pt-1 font-display text-sm font-bold uppercase text-accent lg:block">
          {t('title')}
        </div>
        {items.map((n) => {
          const active = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
          return (
            <Link
              key={n.key}
              href={n.href}
              className={cn(
                'flex shrink-0 items-center gap-2.5 px-3 py-2 text-sm font-semibold transition',
                active
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <n.icon size={16} /> {t(`nav.${n.key}`)}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 space-y-5">{children}</div>
    </div>
  );
}

/** Только для admin (не support). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  const me = useMe();
  if (me.data?.role !== 'admin') {
    return (
      <EmptyState icon={<ShieldAlert size={36} />} title={t('denied')} text={t('deniedText')} />
    );
  }
  return <>{children}</>;
}
