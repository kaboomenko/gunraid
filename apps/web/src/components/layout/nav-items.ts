import { Layers, LayoutGrid, Swords, TrendingUp, User, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  BattleIcon,
  CargoIcon,
  CaseIcon,
  ContractIcon,
  GiftIcon,
  TrophyIcon,
  UpgradeIcon,
} from '@/components/icons/design-icons';

export interface NavItem {
  key: 'cases' | 'upgrade' | 'contract' | 'battles' | 'profile';
  path: string;
  icon: LucideIcon;
}

export const TAB_BAR: NavItem[] = [
  { key: 'cases', path: '', icon: LayoutGrid },
  { key: 'upgrade', path: '/upgrade', icon: TrendingUp },
  { key: 'contract', path: '/contract', icon: Layers },
  { key: 'battles', path: '/battles', icon: Swords },
  { key: 'profile', path: '/profile', icon: User },
];

export interface MenuNavItem {
  key: 'cases' | 'upgrade' | 'contract' | 'battles' | 'cargo' | 'bonuses' | 'leaderboard';
  path: string;
  /** Ключ подписи в messages/ru.json — полный путь. */
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

/**
 * Разделы в мобильном меню (шапка телефона): иконки набора, подписи — как в шапке десктопа;
 * «Лидерборды» — заголовком страницы (nav.leaderboard «Топ» остаётся у меню профиля на десктопе).
 */
export const MENU_NAV: MenuNavItem[] = [
  { key: 'cases', path: '', label: 'nav.cases', icon: CaseIcon },
  { key: 'upgrade', path: '/upgrade', label: 'nav.upgrade', icon: UpgradeIcon },
  { key: 'contract', path: '/contract', label: 'nav.contract', icon: ContractIcon },
  { key: 'battles', path: '/battles', label: 'nav.battles', icon: BattleIcon },
  { key: 'cargo', path: '/cargo', label: 'nav.cargo', icon: CargoIcon },
  { key: 'bonuses', path: '/bonuses', label: 'nav.bonuses', icon: GiftIcon },
  { key: 'leaderboard', path: '/leaderboard', label: 'leaderboard.title', icon: TrophyIcon },
];

export function isActive(pathname: string, game: string, path: string): boolean {
  const full = `/${game}${path}`;
  if (path === '') return pathname === full || pathname.startsWith(`/${game}/case/`);
  return pathname === full || pathname.startsWith(`${full}/`);
}
