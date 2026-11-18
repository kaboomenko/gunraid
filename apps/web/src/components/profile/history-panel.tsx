'use client';

import type { DepositDto, TransactionDto, UserItemDto } from '@gunraid/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useDeposits, useDrops, useTransactions } from '@/lib/queries';

type Kind = 'transactions' | 'deposits' | 'drops';

export function HistoryPanel({ game }: { game: string }) {
  const t = useTranslations('history');
  const [kind, setKind] = useState<Kind>('drops');
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['drops', 'transactions', 'deposits'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'clip-cut h-9 px-4 text-xs font-bold uppercase tracking-wide transition [--cut:6px]',
              kind === k ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
            )}
          >
            {t(k)}
          </button>
        ))}
      </div>
      {kind === 'transactions' && <Transactions />}
      {kind === 'deposits' && <Deposits />}
      {kind === 'drops' && <Drops game={game} />}
    </div>
  );
}

function Transactions() {
  const t = useTranslations('history');
  const format = useFormatter();
  const q = useTransactions();
  const rows: TransactionDto[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!rows.length) return <EmptyState text={t('empty')} />;
  return (
    <Card className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t(`types.${r.type}`)}</div>
            <div className="text-xs text-dim">{format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
          <div className="text-right">
            <GemAmount value={r.amount} signed size="sm" className={r.amount > 0 ? 'text-accent' : 'text-danger'} />
            <div className="text-[11px] text-dim">
              <GemAmount value={r.balanceAfter} size="xs" className="font-normal" />
            </div>
          </div>
        </div>
      ))}
      {q.hasNextPage && (
        <div className="p-3 text-center">
          <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Deposits() {
  const t = useTranslations('history');
  const format = useFormatter();
  const q = useDeposits();
  const rows: DepositDto[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!rows.length) return <EmptyState text={t('empty')} />;
  return (
    <Card className="divide-y divide-line">
      {rows.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <Badge tone={d.status === 'succeeded' ? 'soft' : d.status === 'pending' ? 'warning' : 'danger'}>
              {t(`depositStatus.${d.status}`)}
            </Badge>
            <div className="text-xs text-dim">{format.dateTime(new Date(d.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
          <div className="text-right">
            <GemAmount value={d.gemsAmount} size="sm" />
            {d.bonusGems > 0 && (
              <div className="text-[11px] text-accent">
                +<GemAmount value={d.bonusGems} size="xs" /> {t('bonus')}
              </div>
            )}
          </div>
        </div>
      ))}
      {q.hasNextPage && (
        <div className="p-3 text-center">
          <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Drops({ game }: { game: string }) {
  const t = useTranslations();
  const q = useDrops(game);
  const rows: UserItemDto[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!rows.length) return <EmptyState text={t('history.empty')} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {rows.map((ui) => (
          <ItemTile
            key={ui.id}
            item={ui.item}
            size="sm"
            stLabel={t('items.stattrakBadge')}
            svLabel={t('items.souvenirBadge')}
            dimmed={ui.status !== 'in_inventory'}
            footer={<span className="mt-1 block truncate text-[10px] text-dim">{t(`inventory.status.${ui.status}`)}</span>}
          />
        ))}
      </div>
      {q.hasNextPage && (
        <div className="text-center">
          <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {t('history.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
