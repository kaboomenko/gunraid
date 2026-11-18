'use client';

import type { WithdrawalDto, WithdrawalStatusCode } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';

const TONE: Record<WithdrawalStatusCode, 'neutral' | 'soft' | 'warning' | 'danger' | 'info'> = {
  pending_review: 'warning',
  purchasing: 'info',
  trade_sent: 'info',
  trade_accepted: 'info',
  awaiting_listing: 'warning',
  listing_submitted: 'info',
  completed: 'soft',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
  reversed: 'danger',
};

export function WithdrawalStatusBadge({ status }: { status: WithdrawalStatusCode }) {
  const t = useTranslations('withdraw.statuses');
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}

function ListingForm({ w, onDone }: { w: WithdrawalDto; onDone: () => void }) {
  const t = useTranslations('withdraw.listing');
  const errorText = useErrorMessage();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/withdrawals/${w.id}/listing`, { reference: reference.trim() });
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
      <div className="text-sm font-semibold">{t('title')}</div>
      <p className="text-xs text-muted">
        {t('text', { gold: t('gold', { count: w.priceGold ?? 0 }) })}
      </p>
      {w.expiresAt && (
        <p className="text-xs text-warning">
          {t('deadline')} <Countdown to={w.expiresAt} className="font-semibold tabular" />
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reference.trim()) void submit();
        }}
      >
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value.slice(0, 120))}
          placeholder={t('reference')}
          aria-label={t('reference')}
          className="h-10"
        />
        <Button type="submit" loading={busy} disabled={!reference.trim()}>
          {t('submit')}
        </Button>
      </form>
    </div>
  );
}

/** Вкладка профиля «Выводы»: заявки, статусы, история, лот Standoff 2. */
export function WithdrawalsPanel({ game }: { game: string }) {
  const t = useTranslations('withdraw');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const list = useQuery({
    queryKey: ['withdrawals', game],
    queryFn: () => api.get<WithdrawalDto[]>(`/withdrawals?game=${game}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['withdrawals', game] });
    void qc.invalidateQueries({ queryKey: ['inventory'] });
  };
  const cancel = async (id: string) => {
    try {
      await api.post(`/withdrawals/${id}/cancel`);
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const items = list.data ?? [];
  if (!list.isPending && !items.length) {
    return <EmptyState icon={<ArrowUpFromLine size={32} />} text={t('empty')} />;
  }
  return (
    <div className="space-y-2.5" data-testid="withdrawals-panel">
      {items.map((w) => (
        <Card key={w.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {w.item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.item.imageUrl} alt="" className="h-10 w-16 object-contain" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{w.item.fullName}</div>
              <div className="text-xs text-dim">
                {format.dateTime(new Date(w.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            </div>
            <GemAmount value={w.value} size="sm" />
            <WithdrawalStatusBadge status={w.status} />
            {(w.status === 'pending_review' || w.status === 'awaiting_listing') && (
              <Button size="sm" variant="ghost" onClick={() => void cancel(w.id)}>
                {t('cancel')}
              </Button>
            )}
          </div>
          {w.status === 'awaiting_listing' && <ListingForm w={w} onDone={refresh} />}
          {w.reason && <p className="text-xs text-danger">{t('reason', { reason: w.reason })}</p>}
          {w.status === 'trade_accepted' && w.protectedUntil && (
            <p className="text-xs text-muted">
              {t('protectedUntil', {
                date: format.dateTime(new Date(w.protectedUntil), { dateStyle: 'medium' }),
              })}
            </p>
          )}
          <details className="text-xs text-dim">
            <summary className="cursor-pointer">{t('events')}</summary>
            <ol className="mt-2 space-y-1">
              {w.events.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="tabular">
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                  <span className="text-muted">{t(`statuses.${e.toStatus}`)}</span>
                  {e.note && <span>· {e.note}</span>}
                </li>
              ))}
            </ol>
          </details>
        </Card>
      ))}
    </div>
  );
}
