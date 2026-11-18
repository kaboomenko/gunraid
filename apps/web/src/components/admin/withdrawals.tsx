'use client';

import { type AdminPageDto, type AdminWithdrawalDto, type Cs2StubEvent } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { WithdrawalStatusBadge } from '@/components/withdrawals/withdrawals-panel';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { Pager, fmtDate } from './ui';

const TABS = {
  queue: 'pending_review,listing_submitted',
  active: 'purchasing,trade_sent,trade_accepted,awaiting_listing',
  done: 'completed,rejected,failed,cancelled,expired,reversed',
  all: '',
} as const;

const NEXT_EVENTS: Record<string, Cs2StubEvent[]> = {
  purchasing: ['trade_sent', 'purchase_failed'],
  trade_sent: ['trade_accepted', 'trade_declined'],
  trade_accepted: ['reverse', 'complete'],
};

function WithdrawalCard({ w, onChange }: { w: AdminWithdrawalDto; onChange: () => void }) {
  const t = useTranslations('admin.withdrawals');
  const errorText = useErrorMessage();
  const [gold, setGold] = useState(w.priceGold ? String(w.priceGold) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChange();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const canReject = [
    'pending_review',
    'purchasing',
    'awaiting_listing',
    'listing_submitted',
  ].includes(w.status);
  return (
    <Card className="space-y-3 p-4" data-testid="admin-withdrawal">
      <div className="flex flex-wrap items-center gap-3">
        {w.item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={w.item.imageUrl} alt="" className="h-10 w-16 object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{w.item.fullName}</div>
          <div className="text-xs text-dim">
            <Link href={`/admin/users/${w.user.id}`} className="underline">
              {w.user.nickname}
            </Link>{' '}
            · {w.game} · {fmtDate(w.createdAt)}
          </div>
        </div>
        <GemAmount value={w.value} size="sm" />
        <WithdrawalStatusBadge status={w.status} />
        {w.provider === 'cs2_p2p_stub' && (
          <Badge tone="warning" className="gap-1">
            <FlaskConical size={11} /> {t('stub')}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {t('target')}: <span className="font-mono">{w.target.tradeUrl ?? w.target.playerId}</span>
        </span>
        {w.priceGold && (
          <span>
            {t('priceGold')}: {w.priceGold}
          </span>
        )}
        {w.listing?.reference && (
          <span>
            {t('listing')}: <span className="font-semibold text-text">{w.listing.reference}</span>
          </span>
        )}
        {w.operator && (
          <span>
            {t('operator')}: {w.operator.nickname}
          </span>
        )}
        {(Object.keys(w.flags) as Array<keyof typeof w.flags>)
          .filter((k) => w.flags[k])
          .map((k) => (
            <Badge key={k} tone="danger">
              {t(`flags.${k}`)}
            </Badge>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {w.status === 'pending_review' && (
          <>
            {w.provider === 'so2_manual' && (
              <Input
                value={gold}
                onChange={(e) => setGold(e.target.value.replace(/\D/g, ''))}
                placeholder={t('priceGold')}
                aria-label={t('priceGold')}
                className="h-9 w-40"
              />
            )}
            <Button
              size="sm"
              loading={busy === 'approve'}
              disabled={w.provider === 'so2_manual' && !gold}
              onClick={() =>
                void act('approve', () =>
                  api.post(
                    `/admin/withdrawals/${w.id}/approve`,
                    gold ? { priceGold: Number(gold) } : {},
                  ),
                )
              }
              data-testid="admin-withdrawal-approve"
            >
              {t('approve')}
            </Button>
          </>
        )}
        {w.status === 'listing_submitted' && (
          <Button
            size="sm"
            loading={busy === 'confirm'}
            onClick={() =>
              void act('confirm', () => api.post(`/admin/withdrawals/${w.id}/confirm-purchase`))
            }
          >
            {t('confirmPurchase')}
          </Button>
        )}
        {w.provider === 'cs2_p2p_stub' &&
          (NEXT_EVENTS[w.status] ?? []).map((ev) => (
            <Button
              key={ev}
              size="sm"
              variant="secondary"
              loading={busy === ev}
              onClick={() =>
                void act(ev, () => api.post(`/admin/withdrawals/${w.id}/simulate`, { event: ev }))
              }
              title={t('simulate')}
            >
              {t(`events.${ev}`)}
            </Button>
          ))}
        {canReject && (
          <span className="ml-auto flex gap-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('rejectReason')}
              aria-label={t('rejectReason')}
              className="h-9 w-56"
            />
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'reject'}
              disabled={reason.trim().length < 3}
              onClick={() =>
                void act('reject', () =>
                  api.post(`/admin/withdrawals/${w.id}/reject`, { reason: reason.trim() }),
                )
              }
            >
              {t('reject')}
            </Button>
          </span>
        )}
      </div>
      {w.events.length > 0 && (
        <details className="text-xs text-dim">
          <summary className="cursor-pointer">{t('history', { count: w.events.length })}</summary>
          <ol className="mt-1 space-y-0.5">
            {w.events.map((e, i) => (
              <li key={i}>
                {fmtDate(e.createdAt)} · {e.actorType} · {e.toStatus}
                {e.note ? ` · ${e.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}

export function AdminWithdrawals() {
  const t = useTranslations('admin.withdrawals');
  const tc = useTranslations('admin.common');
  const qc = useQueryClient();
  const [tab, setTab] = useState<keyof typeof TABS>('queue');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'withdrawals', tab, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminWithdrawalDto>>(
        `/admin/withdrawals?page=${page}&pageSize=20${TABS[tab] ? `&status=${TABS[tab]}` : ''}`,
      ),
    refetchInterval: 20_000,
  });
  return (
    <div className="space-y-4">
      <SectionTitle>{t('title')}</SectionTitle>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as keyof typeof TABS);
          setPage(1);
        }}
      >
        <TabsList>
          {(Object.keys(TABS) as Array<keyof typeof TABS>).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="space-y-2.5">
        {(list.data?.items ?? []).map((w) => (
          <WithdrawalCard
            key={w.id}
            w={w}
            onChange={() => void qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] })}
          />
        ))}
        {list.data && !list.data.items.length && (
          <p className="py-8 text-center text-sm text-dim">{tc('empty')}</p>
        )}
      </div>
      {list.data && (
        <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}
