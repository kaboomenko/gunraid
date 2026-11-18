'use client';

import type {
  AdminLedgerRowDto,
  AdminPageDto,
  AdminUserDetailDto,
  AdminUserRowDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Flag, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { AdminSection, AdminTable, Pager, Select, Switch, fmtDate, useDebounced } from './ui';

function UserBadges({ u }: { u: Pick<AdminUserRowDto, 'status' | 'isSuspicious' | 'role'> }) {
  const t = useTranslations();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {u.role !== 'user' && <Badge tone="soft">{t(`roles.${u.role}`)}</Badge>}
      {u.status === 'banned' && <Badge tone="danger">{t('admin.users.banned')}</Badge>}
      {u.isSuspicious && <Badge tone="warning">{t('admin.users.suspicious')}</Badge>}
    </span>
  );
}

export function AdminUsers() {
  const t = useTranslations('admin.users');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [suspicious, setSuspicious] = useState(false);
  const [page, setPage] = useState(1);
  const query = useDebounced(q.trim());
  const list = useQuery({
    queryKey: ['admin', 'users', query, suspicious, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminUserRowDto>>(
        `/admin/users?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}${suspicious ? '&suspicious=1' : ''}`,
      ),
  });
  return (
    <div className="space-y-4">
      <SectionTitle>{t('title')}</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="h-10 max-w-sm"
          data-testid="admin-user-search"
        />
        <Switch
          checked={suspicious}
          onChange={(v) => {
            setSuspicious(v);
            setPage(1);
          }}
          label={t('suspiciousOnly')}
        />
      </div>
      <AdminTable
        rows={list.data?.items ?? []}
        rowKey={(u) => u.id}
        onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
        columns={[
          {
            key: 'user',
            title: '',
            render: (u) => (
              <span className="flex items-center gap-2">
                <Avatar src={u.avatarUrl} name={u.nickname} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{u.nickname}</span>
                  <span className="text-[11px] text-dim">ID {u.shortId}</span>
                </span>
              </span>
            ),
          },
          { key: 'badges', title: '', render: (u) => <UserBadges u={u} /> },
          {
            key: 'level',
            title: t('level'),
            className: 'text-right tabular',
            render: (u) => u.level,
          },
          {
            key: 'balance',
            title: t('balance'),
            className: 'text-right',
            render: (u) => <GemAmount value={u.balance} size="sm" />,
          },
          {
            key: 'deposits',
            title: t('deposits'),
            className: 'text-right',
            render: (u) => <GemAmount value={u.depositsGems} size="sm" />,
          },
          {
            key: 'created',
            title: t('registered'),
            className: 'text-xs text-muted',
            render: (u) => fmtDate(u.createdAt),
          },
          {
            key: 'seen',
            title: t('lastSeen'),
            className: 'text-xs text-muted',
            render: (u) => fmtDate(u.lastSeenAt),
          },
        ]}
      />
      {list.data && (
        <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}

function BalanceForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const t = useTranslations('admin.users');
  const tg = useTranslations('gems');
  const errorText = useErrorMessage();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || reason.trim().length < 5) return;
    setBusy(true);
    try {
      const res = await api.post<{ balance: number }>(
        `/admin/users/${userId}/balance`,
        { amount: n, reason: reason.trim() },
        { idempotencyKey: newIdempotencyKey() },
      );
      toast.success(t('adjusted', { balance: tg('amount', { count: res.balance }) }));
      setAmount('');
      setReason('');
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="font-semibold">{t('adjust')}</div>
      <p className="text-xs text-dim">{t('adjustHint')}</p>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))}
          placeholder={t('adjustAmount')}
          aria-label={t('adjustAmount')}
          className="h-10"
          data-testid="admin-adjust-amount"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('adjustReason')}
          aria-label={t('adjustReason')}
          className="h-10"
          data-testid="admin-adjust-reason"
        />
        <Button
          loading={busy}
          disabled={!amount || reason.trim().length < 5}
          onClick={() => void submit()}
          data-testid="admin-adjust-submit"
        >
          {t('adjustSubmit')}
        </Button>
      </div>
    </Card>
  );
}

export function AdminUserDetail({ id }: { id: string }) {
  const t = useTranslations('admin.users');
  const tr = useTranslations('roles');
  const tp = useTranslations('providers');
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const isAdmin = me.data?.role === 'admin';
  const [ledgerPage, setLedgerPage] = useState(1);
  const [banReason, setBanReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const user = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => api.get<AdminUserDetailDto>(`/admin/users/${id}`),
  });
  const ledger = useQuery({
    queryKey: ['admin', 'user', id, 'ledger', ledgerPage],
    queryFn: () =>
      api.get<AdminPageDto<AdminLedgerRowDto>>(
        `/admin/users/${id}/ledger?page=${ledgerPage}&pageSize=20`,
      ),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const u = user.data;
  if (!u) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-5">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <Avatar src={u.avatarUrl} name={u.nickname} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl font-bold">{u.nickname}</span>
            <UserBadges u={u} />
          </div>
          <div className="text-xs text-dim">
            ID {u.shortId} · {u.id} · {t('registered')}: {fmtDate(u.createdAt)} · {t('lastSeen')}:{' '}
            {fmtDate(u.lastSeenAt)}
          </div>
          {u.banReason && (
            <div className="text-xs text-danger">{t('banned_at', { reason: u.banReason })}</div>
          )}
          {u.referredBy && (
            <div className="text-xs text-muted">
              {t('referredBy')}:{' '}
              <Link className="underline" href={`/admin/users/${u.referredBy.id}`}>
                {u.referredBy.nickname}
              </Link>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-dim">{t('balance')}</div>
          <GemAmount value={u.balance} size="lg" className="text-accent" />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ['deposits', <GemAmount key="d" value={u.depositsGems} />, `${u.stats.depositsCount}`],
            [
              'withdrawn',
              <GemAmount key="w" value={u.stats.withdrawalsValue} />,
              `${u.stats.withdrawalsCount}`,
            ],
            ['inventoryValue', <GemAmount key="i" value={u.stats.inventoryValue} />, null],
            [
              'ledgerSum',
              <GemAmount
                key="l"
                value={u.stats.ledgerSum}
                className={u.stats.ledgerSum === u.balance ? '' : 'text-danger'}
              />,
              null,
            ],
            ['level', <span key="lv">{u.level}</span>, null],
          ] as const
        ).map(([k, v, hint]) => (
          <Card key={k} className="space-y-1 p-3">
            <div className="text-[11px] uppercase tracking-wider text-dim">{t(k)}</div>
            <div className="font-semibold">{v}</div>
            {hint && <div className="text-[11px] text-dim">{hint}</div>}
          </Card>
        ))}
      </div>

      {isAdmin && (
        <div className="grid gap-4 xl:grid-cols-2">
          <BalanceForm userId={u.id} onDone={refresh} />
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {u.status === 'banned' ? (
                <Button
                  variant="secondary"
                  onClick={() => void act(() => api.post(`/admin/users/${u.id}/unban`))}
                >
                  <ShieldCheck size={16} /> {t('unban')}
                </Button>
              ) : (
                <>
                  <Input
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    placeholder={t('banReason')}
                    aria-label={t('banReason')}
                    className="h-10 flex-1"
                  />
                  <Button
                    variant="danger"
                    disabled={banReason.trim().length < 3}
                    onClick={() =>
                      void act(() =>
                        api.post(`/admin/users/${u.id}/ban`, { reason: banReason.trim() }),
                      )
                    }
                  >
                    <Ban size={16} /> {t('ban')}
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={note ?? u.suspiciousNote ?? ''}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('note')}
                aria-label={t('note')}
                className="h-10 flex-1"
              />
              <Button
                variant={u.isSuspicious ? 'secondary' : 'outline'}
                onClick={() =>
                  void act(() =>
                    api.patch(`/admin/users/${u.id}`, {
                      isSuspicious: !u.isSuspicious,
                      suspiciousNote: (note ?? u.suspiciousNote ?? '') || null,
                    }),
                  )
                }
              >
                <Flag size={16} /> {u.isSuspicious ? t('unflag') : t('flag')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">{t('role')}</span>
              <Select value={role ?? u.role} onChange={(e) => setRole(e.target.value)}>
                {(['user', 'support', 'admin'] as const).map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={!role || role === u.role}
                onClick={() => void act(() => api.patch(`/admin/users/${u.id}`, { role }))}
              >
                {t('roleSave')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminSection title={t('identities')}>
          <Card className="space-y-1.5 p-3 text-sm">
            {u.identities.map((i) => (
              <div key={`${i.provider}-${i.providerUserId}`} className="flex justify-between gap-2">
                <span className="font-semibold">{tp(i.provider)}</span>
                <span className="truncate text-xs text-dim">
                  {i.displayName ?? i.providerUserId}
                </span>
              </div>
            ))}
            {u.gameProfiles.map((g) => (
              <div key={g.game} className="flex justify-between gap-2 text-xs">
                <span className="text-muted">{g.game}</span>
                <span className="truncate text-dim">{g.tradeUrl ?? g.playerId ?? '—'}</span>
              </div>
            ))}
          </Card>
        </AdminSection>
        <AdminSection title={t('linked')}>
          <Card className="space-y-2 p-3 text-sm">
            <p className="text-xs text-dim">{t('linkedHint')}</p>
            {u.linked.length ? (
              u.linked.map((l) => (
                <Link
                  key={l.id}
                  href={`/admin/users/${l.id}`}
                  className="flex items-center justify-between gap-2 hover:text-accent"
                >
                  <span className="font-semibold">
                    {l.nickname} <span className="text-xs text-dim">ID {l.shortId}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {t(`via.${l.via}`)}: {l.value}
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-xs text-muted">{t('noLinked')}</p>
            )}
          </Card>
        </AdminSection>
      </div>

      <AdminSection title={t('ledger')}>
        <AdminTable
          rows={ledger.data?.items ?? []}
          rowKey={(r) => String(r.id)}
          columns={[
            {
              key: 'date',
              title: '',
              className: 'text-xs text-muted whitespace-nowrap',
              render: (r) => fmtDate(r.createdAt),
            },
            {
              key: 'type',
              title: '',
              render: (r) => <span className="font-mono text-xs">{r.type}</span>,
            },
            {
              key: 'amount',
              title: '',
              className: 'text-right',
              render: (r) => (
                <GemAmount
                  value={r.amount}
                  size="sm"
                  signed
                  className={r.amount > 0 ? 'text-accent' : ''}
                />
              ),
            },
            {
              key: 'after',
              title: '',
              className: 'text-right',
              render: (r) => <GemAmount value={r.balanceAfter} size="sm" />,
            },
            {
              key: 'reason',
              title: '',
              className: 'text-xs text-dim',
              render: (r) => r.reason ?? r.refType,
            },
          ]}
        />
        {ledger.data && (
          <Pager
            page={ledgerPage}
            pageSize={ledger.data.pageSize}
            total={ledger.data.total}
            onPage={setLedgerPage}
          />
        )}
      </AdminSection>

      <AdminSection title={t('access')}>
        <AdminTable
          rows={u.access}
          rowKey={(a) => `${a.createdAt}-${a.event}-${a.ip}`}
          columns={[
            {
              key: 'date',
              title: '',
              className: 'text-xs text-muted whitespace-nowrap',
              render: (a) => fmtDate(a.createdAt),
            },
            { key: 'event', title: '', render: (a) => a.event },
            { key: 'ip', title: 'IP', className: 'font-mono text-xs', render: (a) => a.ip ?? '—' },
            {
              key: 'device',
              title: '',
              className: 'font-mono text-xs',
              render: (a) => a.deviceId?.slice(0, 12) ?? '—',
            },
            {
              key: 'ua',
              title: '',
              className: 'max-w-[260px] truncate text-xs text-dim',
              render: (a) => a.userAgent ?? '',
            },
          ]}
        />
      </AdminSection>
    </div>
  );
}
