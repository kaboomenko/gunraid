'use client';

import type { AdminDashboardDto } from '@gunraid/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { cn } from '@/lib/cn';
import { AdminTable, Select, StatCard, fmtDate, pct } from './ui';

export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const config = useConfig();
  const [days, setDays] = useState(7);
  const [game, setGame] = useState('');
  const q = useQuery({
    queryKey: ['admin', 'dashboard', days, game],
    queryFn: () =>
      api.get<AdminDashboardDto>(`/admin/dashboard?days=${days}${game ? `&game=${game}` : ''}`),
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('title')}</SectionTitle>
        <div className="flex gap-2">
          <Select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t('period')}
          >
            {[1, 7, 30, 90].map((n) => (
              <option key={n} value={n}>
                {t('days', { count: n })}
              </option>
            ))}
          </Select>
          <Select value={game} onChange={(e) => setGame(e.target.value)} aria-label="game">
            <option value="">{t('allGames')}</option>
            {config.games.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('users')}
              value={d.users.total.toLocaleString('ru-RU')}
              hint={`+${d.users.new} ${t('usersNew')} · ${d.users.active} ${t('usersActive')}`}
            />
            <StatCard
              label={t('deposits')}
              value={<GemAmount value={d.deposits.gems} size="lg" />}
              hint={`${d.deposits.count} · ${d.deposits.users} ${t('depositsUsers')}`}
            />
            <StatCard
              label={t('withdrawals')}
              value={<GemAmount value={d.withdrawals.completedValue} size="lg" />}
              hint={`${d.withdrawals.pending} ${t('pending')} · ${d.withdrawals.completedCount} ${t('completed')}`}
            />
            <StatCard
              accent
              label={t('ggr')}
              value={
                <GemAmount
                  value={d.ggr}
                  size="lg"
                  className={d.ggr >= 0 ? 'text-accent' : 'text-danger'}
                />
              }
              hint={t('ggrHint')}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label={t('bonuses')} value={<GemAmount value={d.bonuses} size="lg" />} />
            <StatCard
              label={t('recon')}
              value={
                d.reconciliation.mismatches === null ? (
                  <span className="text-base text-dim">{t('reconNever')}</span>
                ) : d.reconciliation.mismatches === 0 ? (
                  <span className="flex items-center gap-2 text-base text-accent">
                    <CheckCircle2 size={18} /> {t('reconOk')}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-base text-danger">
                    <AlertTriangle size={18} />{' '}
                    {t('reconBad', { count: d.reconciliation.mismatches })}
                  </span>
                )
              }
              hint={fmtDate(d.reconciliation.checkedAt)}
            />
          </div>
          <AdminTable
            rows={d.modes}
            rowKey={(m) => m.mode}
            columns={[
              {
                key: 'mode',
                title: t('mode'),
                render: (m) => <span className="font-semibold">{t(`modeNames.${m.mode}`)}</span>,
              },
              {
                key: 'count',
                title: t('count'),
                className: 'text-right tabular',
                render: (m) => m.count.toLocaleString('ru-RU'),
              },
              {
                key: 'wagered',
                title: t('wagered'),
                className: 'text-right',
                render: (m) => <GemAmount value={m.wagered} size="sm" />,
              },
              {
                key: 'paid',
                title: t('paid'),
                className: 'text-right',
                render: (m) => <GemAmount value={m.paid} size="sm" />,
              },
              {
                key: 'ggr',
                title: t('ggr'),
                className: 'text-right',
                render: (m) => (
                  <GemAmount
                    value={m.ggr}
                    size="sm"
                    className={m.ggr >= 0 ? 'text-accent' : 'text-danger'}
                  />
                ),
              },
              {
                key: 'rtp',
                title: t('rtp'),
                className: 'text-right tabular',
                render: (m) => (
                  <span
                    className={cn(
                      m.rtp !== null &&
                        m.targetRtp !== null &&
                        Math.abs(m.rtp - m.targetRtp) > 0.1 &&
                        'text-warning',
                    )}
                  >
                    {pct(m.rtp)}
                  </span>
                ),
              },
              {
                key: 'target',
                title: t('target'),
                className: 'text-right tabular text-muted',
                render: (m) => pct(m.targetRtp),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
