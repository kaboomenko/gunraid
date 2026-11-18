import {
  Gift,
  LayoutGrid,
  Layers,
  Swords,
  Trophy,
  TrendingUp,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: 'cases' | 'upgrade' | 'contract' | 'battles' | 'bonuses' | 'leaderboard' | 'profile';
  path: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { key: 'cases', path: '', icon: LayoutGrid },
  { key: 'upgrade', path: '/upgrade', icon: TrendingUp },
  { key: 'contract', path: '/contract', icon: Layers },
  { key: 'battles', path: '/battles', icon: Swords },
  { key: 'bonuses', path: '/bonuses', icon: Gift },
  { key: 'leaderboard', path: '/leaderboard', icon: Trophy },
];

export const TAB_BAR: NavItem[] = [
  { key: 'cases', path: '', icon: LayoutGrid },
  { key: 'upgrade', path: '/upgrade', icon: TrendingUp },
  { key: 'contract', path: '/contract', icon: Layers },
  { key: 'battles', path: '/battles', icon: Swords },
  { key: 'profile', path: '/profile', icon: User },
];

export function isActive(pathname: string, game: string, path: string): boolean {
  const full = `/${game}${path}`;
  if (path === '') return pathname === full || pathname.startsWith(`/${game}/case/`);
  return pathname === full || pathname.startsWith(`${full}/`);
}
