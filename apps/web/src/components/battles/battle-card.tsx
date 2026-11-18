'use client';

import type { BattleListItemDto } from '@gunraid/shared';
import { Eye, Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { GemAmount } from '@/components/ui/gem';
import { cn } from '@/lib/cn';
import { CasesThumbs, FormatBadge, ModeBadge, PlayersRow, playerName } from './battle-parts';

/** Строка лобби в списке баттлов. */
export function BattleCard({ battle, meId }: { battle: BattleListItemDto; meId: string | null }) {
  const t = useTranslations('battles');
  const href = `/${battle.game}/battles/${battle.id}`;
  const free = battle.players.filter((p) => !p).length;
  const mine = Boolean(meId && battle.players.some((p) => p?.user?.id === meId));
  const canJoin = battle.status === 'waiting' && free > 0 && !mine;
  const winners = battle.winnerSlots?.map((s) => battle.players[s]).filter(Boolean) ?? [];
  return (
    <div
      className={cn(
        'cut grid gap-3 p-3 transition sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:p-4',
        battle.status === 'waiting'
          ? '[--cut-border:rgb(198_255_0/0.28)]'
          : '[--cut-bg:var(--color-surface-1)]',
      )}
      data-testid="battle-card"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1.5">
          <FormatBadge format={battle.format} />
          <ModeBadge mode={battle.mode} />
        </div>
        <div className="min-w-0 space-y-1">
          <CasesThumbs cases={battle.cases} />
          <div className="text-[11px] text-dim">{t('rounds', { count: battle.roundsCount })}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <PlayersRow
          format={battle.format}
          players={battle.players}
          winnerSlots={battle.winnerSlots}
        />
        {battle.status === 'finished' && winners.length > 0 && (
          <span className="hidden min-w-0 items-center gap-1 truncate text-xs text-muted lg:flex">
            <Trophy size={13} className="shrink-0 text-accent" />
            <span className="truncate">{winners.map((p) => playerName(p!)).join(', ')}</span>
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-dim">
            {battle.status === 'finished' ? t('totalPot') : t('entry')}
          </div>
          <GemAmount
            value={battle.status === 'finished' ? battle.totalValue : battle.entryPrice}
            className={battle.status === 'finished' ? 'text-accent' : ''}
          />
        </div>
        {canJoin ? (
          <Button asChild size="sm" className="min-w-24">
            <Link href={href}>{t('join')}</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="secondary" className="min-w-24">
            <Link href={href}>
              <Eye size={14} /> {t('watch')}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
