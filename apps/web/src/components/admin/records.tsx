'use client';

import type { AdminAuditRowDto, AdminDepositDto, AdminPageDto } from '@gunraid/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { api } from '@/lib/api';
import { AdminTable, Pager, Select, fmtDate } from './ui';

export function AdminDeposits() {
  const t = useTranslations('admin');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'deposits', status, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminDepositDto>>(
        `/admin/deposits?page=${page}${status ? `&status=${status}` : ''}`,
      ),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('deposits.title')}</SectionTitle>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t('common.status')}
        >
          <option value="">{t('common.all')}</option>
          {['pending', 'succeeded', 'failed', 'cancelled', 'expired'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <AdminTable
        rows={list.data?.items ?? []}
        rowKey={(d) => d.id}
        columns={[
          {
            key: 'date',
            title: t('common.date'),
            className: 'whitespace-nowrap text-xs text-muted',
            render: (d) => fmtDate(d.createdAt),
          },
          {
            key: 'user',
            title: t('common.user'),
            render: (d) => (
              <Link href={`/admin/users/${d.user.id}`} className="font-semibold hover:text-accent">
                {d.user.nickname}
              </Link>
            ),
          },
          {
            key: 'method',
            title: t('deposits.method'),
            className: 'text-xs',
            render: (d) => `${d.provider} · ${d.method}`,
          },
          {
            key: 'paid',
            title: t('deposits.paid'),
            className: 'text-right tabular',
            render: (d) => `${d.payAmount} ${d.payCurrency}`,
          },
          {
            key: 'gems',
            title: t('deposits.gems'),
            className: 'text-right',
            render: (d) => <GemAmount value={d.gemsAmount} size="sm" />,
          },
          {
            key: 'bonus',
            title: t('deposits.bonus'),
            className: 'text-right',
            render: (d) => (d.bonusGems ? <GemAmount value={d.bonusGems} size="sm" signed /> : '—'),
          },
          {
            key: 'status',
            title: t('common.status'),
            render: (d) => (
              <Badge
                tone={
                  d.status === 'succeeded' ? 'soft' : d.status === 'pending' ? 'warning' : 'neutral'
                }
              >
                {d.status}
              </Badge>
            ),
          },
        ]}
      />
      {list.data && (
        <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

export function AdminAudit() {
  const t = useTranslations('admin');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'audit', entity, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminAuditRowDto>>(
        `/admin/audit?page=${page}${entity ? `&entityType=${entity}` : ''}`,
      ),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('audit.title')}</SectionTitle>
        <Select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          aria-label={t('audit.entity')}
        >
          <option value="">{t('common.all')}</option>
          {[
            'user',
            'withdrawal',
            'case',
            'item',
            'settings',
            'promo_code',
            'wheel_prize',
            'partner',
            'leaderboard',
            'levels',
            'achievement',
            'fx_rate',
            'rarity',
          ].map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
      </div>
      <AdminTable
        rows={list.data?.items ?? []}
        rowKey={(r) => String(r.id)}
        columns={[
          {
            key: 'date',
            title: t('common.date'),
            className: 'whitespace-nowrap text-xs text-muted',
            render: (r) => fmtDate(r.createdAt),
          },
          {
            key: 'actor',
            title: t('audit.actor'),
            render: (r) => r.actor?.nickname ?? t('audit.system'),
          },
          {
            key: 'action',
            title: t('audit.action'),
            render: (r) => <span className="font-mono text-xs">{r.action}</span>,
          },
          {
            key: 'entity',
            title: t('audit.entity'),
            className: 'text-xs',
            render: (r) =>
              r.entityType === 'user' && r.entityId ? (
                <Link href={`/admin/users/${r.entityId}`} className="underline">
                  {r.entityType}
                </Link>
              ) : (
                `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}`
              ),
          },
          {
            key: 'changes',
            title: t('audit.changes'),
            className: 'max-w-[380px] text-[11px] text-dim',
            render: (r) => (
              <span className="block truncate" title={short(r.after)}>
                {r.reason ? `«${r.reason}» ` : ''}
                {short(r.after)}
              </span>
            ),
          },
        ]}
      />
      {list.data && (
        <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}
