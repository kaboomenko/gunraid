'use client';

import type { UserItemDto, WithdrawalDto, WithdrawalRequirementsDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { GemAmount } from '@/components/ui/gem';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${ok ? 'text-text' : 'text-muted'}`}>
      {ok ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
      ) : (
        <Circle size={16} className="mt-0.5 shrink-0 text-dim" />
      )}
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Окно вывода: условия, инструкция по игре, отправка заявки. */
export function WithdrawModal({
  game,
  item,
  onClose,
}: {
  game: string;
  item: UserItemDto | null;
  onClose: () => void;
}) {
  const t = useTranslations('withdraw');
  const tg = useTranslations('gems');
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const req = useQuery({
    queryKey: ['withdraw-req', game],
    enabled: Boolean(item),
    queryFn: () => api.get<WithdrawalRequirementsDto>(`/games/${game}/withdrawals/requirements`),
  });
  const r = req.data;
  const depositOk = r ? r.depositedGems >= r.minDepositGems : false;
  const ready = Boolean(
    r && r.targetSet && (!r.steamRequired || r.steamLinked) && depositOk && !r.availableAt,
  );

  const submit = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.post<WithdrawalDto>(
        `/games/${game}/withdrawals`,
        { userItemId: item.id },
        { idempotencyKey: newIdempotencyKey() },
      );
      toast.success(t('sent'));
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['withdrawals'] });
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(item)} onOpenChange={(v) => !v && onClose()} title={t('title')} size="md">
      {item && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('lead')}</p>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <ItemTile item={item.item} stLabel="ST" svLabel="SV" />
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-dim">
                {t('requirements')}
              </div>
              {r ? (
                <ul className="space-y-1.5">
                  <Req ok={r.targetSet}>
                    {r.targetField === 'trade_url' ? t('targetTradeUrl') : t('targetPlayerId')}
                    {!r.targetSet && (
                      <Link
                        href={`/${game}/profile?tab=settings`}
                        onClick={onClose}
                        className="ml-2 font-semibold text-accent underline"
                      >
                        {t('setInSettings')}
                      </Link>
                    )}
                  </Req>
                  {r.steamRequired && <Req ok={r.steamLinked}>{t('steam')}</Req>}
                  <Req ok={depositOk}>
                    {t('deposit', { gems: tg('amount', { count: r.minDepositGems }) })}
                  </Req>
                  <Req ok={!r.availableAt}>
                    {t('delay')}
                    {r.availableAt && (
                      <span className="block text-xs text-dim">
                        {t('availableIn')} <Countdown to={r.availableAt} className="tabular" />
                      </span>
                    )}
                  </Req>
                  {r.newAccountLimit !== null && (
                    <Req ok={r.newAccountUsedToday + item.item.price <= r.newAccountLimit}>
                      {t('newLimit', {
                        limit: tg('amount', { count: r.newAccountLimit }),
                        used: tg('amount', { count: r.newAccountUsedToday }),
                      })}
                    </Req>
                  )}
                </ul>
              ) : (
                <div className="skeleton h-24" />
              )}
            </div>
          </div>
          <div className="clip-cut space-y-1.5 bg-surface-2 p-3 text-xs text-muted [--cut:6px]">
            <div className="font-semibold text-text">
              {game === 'cs2' ? t('cs2How') : t('so2How')}
            </div>
            <ol className="list-decimal space-y-1 pl-4">
              {game === 'cs2' ? (
                <>
                  <li>{t('cs2Steps.s1')}</li>
                  <li>{t('cs2Steps.s2')}</li>
                  <li>{t('cs2Steps.s3', { days: 7 })}</li>
                </>
              ) : (
                <>
                  <li>{t('so2Steps.s1')}</li>
                  <li>{t('so2Steps.s2', { minutes: r?.so2ListingTimeoutMinutes ?? 30 })}</li>
                  <li>{t('so2Steps.s3')}</li>
                </>
              )}
            </ol>
            {game === 'cs2' && (
              <p className="flex items-center gap-1.5 pt-1 text-warning">
                <FlaskConical size={12} /> {t('stub')}
              </p>
            )}
          </div>
          <Button
            block
            size="lg"
            loading={busy}
            disabled={!ready}
            onClick={() => void submit()}
            data-testid="withdraw-submit"
          >
            {t('submit')} <GemAmount value={item.item.price} size="sm" />
          </Button>
        </div>
      )}
    </Modal>
  );
}
