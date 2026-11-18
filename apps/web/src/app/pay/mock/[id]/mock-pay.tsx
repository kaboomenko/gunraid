'use client';

import type { DepositDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useGameCode } from '@/lib/game';
import { useInvalidateWallet } from '@/lib/queries';

/** ЗАГЛУШКА платёжного провайдера (раздел 12 ТЗ): «оплата» кнопками «успех» / «ошибка». */
export function MockPay({ id }: { id: string }) {
  const t = useTranslations();
  const game = useGameCode();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const [busy, setBusy] = useState<'success' | 'fail' | null>(null);
  const dep = useQuery({ queryKey: ['deposit', id], queryFn: () => api.get<DepositDto>(`/deposits/${id}`), retry: false });

  const complete = async (result: 'success' | 'fail') => {
    setBusy(result);
    try {
      const updated = await api.post<DepositDto>(`/payments/mock/${id}/complete`, { result });
      qc.setQueryData(['deposit', id], updated);
      invalidate();
      if (updated.status === 'succeeded') toast.success(t('pay.succeeded'));
      else toast.error(t('pay.failed'));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (dep.isLoading) return <Skeleton className="mx-auto h-72 max-w-md" />;
  if (!dep.data) return <EmptyState title={t('pay.notFound')} />;
  const d = dep.data;
  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <Card cut="lg" className="space-y-5 p-6">
        <div className="flex items-center gap-3">
          <span className="clip-cut grid h-11 w-11 place-items-center bg-warning/15 text-warning [--cut:6px]">
            <FlaskConical size={22} />
          </span>
          <div>
            <h1 className="font-display text-xl font-extrabold uppercase">{t('pay.title')}</h1>
            <p className="text-xs text-muted">{t('pay.subtitle')}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-dim">{t('pay.amount')}</span>
            <span className="font-semibold">
              {d.payAmount} {d.payCurrency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-dim">{t('pay.gems')}</span>
            <GemAmount value={d.gemsAmount + d.bonusGems} className="text-accent" />
          </div>
          <div className="flex justify-between">
            <span className="text-dim">{t('pay.status')}</span>
            <Badge tone={d.status === 'succeeded' ? 'soft' : d.status === 'pending' ? 'warning' : 'danger'}>
              {t(`history.depositStatus.${d.status}`)}
            </Badge>
          </div>
        </div>
        {d.status === 'pending' ? (
          <div className="grid grid-cols-2 gap-3">
            <Button loading={busy === 'success'} disabled={Boolean(busy)} onClick={() => void complete('success')} data-testid="mock-pay-success">
              <CheckCircle2 size={18} /> {t('pay.success')}
            </Button>
            <Button variant="danger" loading={busy === 'fail'} disabled={Boolean(busy)} onClick={() => void complete('fail')}>
              <XCircle size={18} /> {t('pay.fail')}
            </Button>
          </div>
        ) : (
          <Button asChild block variant="secondary">
            <Link href={`/${game}/profile?tab=history`}>{t('pay.back')}</Link>
          </Button>
        )}
      </Card>
    </div>
  );
}
