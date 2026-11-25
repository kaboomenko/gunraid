'use client';

import type {
  BattleFormatCode,
  BattleListCaseDto,
  BattleModeCode,
  BattlePlayerDto,
} from '@gunraid/shared';
import { Bot, Crown, Flame, Swords, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function FormatBadge({ format }: { format: BattleFormatCode }) {
  const t = useTranslations('battles');
  return (
    <Badge tone="neutral" className="gap-1.5">
      <Swords size={12} /> {t(`formatsShort.${format}`)}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: BattleModeCode }) {
  const t = useTranslations('battles');
  return mode === 'crazy' ? (
    <Badge tone="danger" className="gap-1.5" title={t('modeHints.crazy')}>
      <Flame size={12} /> {t('modes.crazy')}
    </Badge>
  ) : (
    <Badge tone="soft" className="gap-1.5" title={t('modeHints.classic')}>
      {t('modes.classic')}
    </Badge>
  );
}

export function playerName(p: BattlePlayerDto): string {
  return p.user?.nickname ?? p.bot?.nickname ?? '';
}

/** Аватар участника (бот — с иконкой) или пустое место. */
export function PlayerAvatar({
  player,
  size = 'sm',
  highlight,
}: {
  player: BattlePlayerDto | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  const t = useTranslations('battles');
  if (!player) {
    return (
      <span
        className={cn(
          'clip-cut inline-grid shrink-0 place-items-center border border-dashed border-line-strong bg-surface-2 text-dim [--cut:6px]',
          size === 'xs'
            ? 'h-6 w-6'
            : size === 'sm'
              ? 'h-8 w-8'
              : size === 'md'
                ? 'h-10 w-10'
                : 'h-16 w-16',
        )}
        title={t('freeSlot')}
      >
        <UserPlus size={size === 'lg' ? 22 : 14} />
      </span>
    );
  }
  return (
    <span className="relative inline-flex">
      <Avatar
        src={player.user?.avatarUrl ?? player.bot?.avatarUrl ?? null}
        name={playerName(player)}
        size={size}
        className={cn(highlight && 'ring-2 ring-accent')}
      />
      {player.bot && (
        <span className="clip-cut absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center bg-info text-bg [--cut:3px]">
          <Bot size={10} />
        </span>
      )}
      {highlight && (
        <Crown size={14} className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-accent" />
      )}
    </span>
  );
}

/** Ряд аватаров по местам; в 2×2 — две команды через VS. */
export function PlayersRow({
  format,
  players,
  winnerSlots,
}: {
  format: BattleFormatCode;
  players: Array<BattlePlayerDto | null>;
  winnerSlots?: number[] | null;
}) {
  const t = useTranslations('battles');
  const avatar = (p: BattlePlayerDto | null, i: number) => (
    <PlayerAvatar key={i} player={p} highlight={Boolean(winnerSlots?.includes(i))} />
  );
  if (format === '2v2') {
    return (
      <div className="flex items-center gap-1.5">
        {players.slice(0, 2).map(avatar)}
        <span className="px-1 font-display text-[11px] font-bold text-dim">{t('vs')}</span>
        {players.slice(2, 4).map((p, i) => avatar(p, i + 2))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {players.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="font-display text-[10px] font-bold text-dim">{t('vs')}</span>}
          {avatar(p, i)}
        </span>
      ))}
    </div>
  );
}

/** Миниатюры кейсов баттла с количеством. */
export function CasesThumbs({ cases, max = 5 }: { cases: BattleListCaseDto[]; max?: number }) {
  const shown = cases.slice(0, max);
  const rest = cases.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      {shown.map((c) => (
        <span
          key={c.caseId}
          className="clip-cut relative grid h-11 w-11 shrink-0 place-items-center bg-surface-2 [--cut:6px]"
          style={{
            background: `radial-gradient(80% 80% at 50% 100%, ${c.accentColor}40, var(--color-surface-2) 70%)`,
          }}
          title={c.name}
        >
          {c.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.imageUrl} alt={c.name} className="h-9 w-9 object-contain" />
          )}
          {c.count > 1 && (
            <span className="absolute -right-0.5 -top-0.5 bg-accent px-1 text-[10px] font-bold text-accent-ink">
              ×{c.count}
            </span>
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-xs font-semibold text-dim">+{rest}</span>}
    </div>
  );
}
