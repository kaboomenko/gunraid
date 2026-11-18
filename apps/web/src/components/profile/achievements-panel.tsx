'use client';

import type { AchievementDto } from '@gunraid/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Boxes,
  CalendarCheck,
  Gem,
  Layers,
  Lock,
  Star,
  Swords,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { bonusKeys } from '@/lib/queries';

const ICONS: Record<string, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  'trending-up': TrendingUp,
  zap: Zap,
  layers: Layers,
  swords: Swords,
  trophy: Trophy,
  gem: Gem,
  star: Star,
  'calendar-check': CalendarCheck,
  wallet: Wallet,
  users: Users,
};

/** Значок достижения: гранёная плашка с иконкой; закрытые — приглушены. */
export function AchievementBadge({ a, size = 'md' }: { a: AchievementDto; size?: 'sm' | 'md' }) {
  const Icon = ICONS[a.icon] ?? Trophy;
  const unlocked = Boolean(a.unlockedAt);
  return (
    <span
      className={cn(
        'clip-cut relative grid shrink-0 place-items-center [--cut:8px]',
        size === 'md' ? 'h-14 w-14' : 'h-10 w-10',
        unlocked
          ? 'bg-[radial-gradient(circle_at_30%_20%,#d6ff4a,#8dba00)] text-accent-ink shadow-[0_0_18px_rgba(198,255,0,0.35)]'
          : 'bg-surface-3 text-dim',
      )}
      title={a.name}
    >
      <Icon size={size === 'md' ? 26 : 18} strokeWidth={2.2} />
      {!unlocked && <Lock size={12} className="absolute bottom-1 right-1" />}
    </span>
  );
}

export function AchievementsPanel() {
  const t = useTranslations('achievements');
  const format = useFormatter();
  const list = useQuery({
    queryKey: bonusKeys.achievements,
    queryFn: () => api.get<AchievementDto[]>('/me/achievements'),
  });
  const items = list.data ?? [];
  const unlocked = items.filter((a) => a.unlockedAt).length;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted">{t('count', { unlocked, total: items.length })}</div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="achievements">
        {items.map((a) => (
          <div
            key={a.code}
            className={cn('cut flex items-center gap-3 p-3', !a.unlockedAt && 'opacity-80')}
          >
            <AchievementBadge a={a} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate font-semibold">{a.name}</div>
              <div className="text-xs text-muted">{a.description}</div>
              {a.unlockedAt ? (
                <div className="text-[11px] text-accent">
                  {t('unlocked', {
                    date: format.dateTime(new Date(a.unlockedAt), { dateStyle: 'medium' }),
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Progress value={a.progress} max={a.target} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-dim tabular">
                    {t('progress', { progress: a.progress, target: a.target })}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
