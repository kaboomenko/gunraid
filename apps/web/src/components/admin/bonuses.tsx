'use client';

import type {
  AdminAchievementDto,
  AdminLeaderboardDto,
  AdminPartnerDto,
  AdminPromoBody,
  AdminPromoDto,
  AdminWheelPrizeBody,
  AdminWheelPrizeDto,
  LevelRowDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Field, Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { GameSelect } from './cases';
import { AdminTable, Select, Switch, fmtDate, useDebounced } from './ui';

type PrizeType = AdminWheelPrizeBody['type'];
const PRIZE_TYPES: PrizeType[] = ['balance', 'item', 'free_case', 'deposit_bonus', 'extra_spin'];
const PROMO_TYPES: AdminPromoBody['type'][] = [
  'balance',
  'deposit_bonus',
  'free_case',
  'wheel_spin',
  'item',
];

interface Refs {
  cases: Array<{ id: string; name: string; price: number }>;
  items: Array<{ id: string; name: string; price: number }>;
}

function useRefs(game: string, q: string) {
  const query = useDebounced(q);
  return useQuery({
    queryKey: ['admin', 'refs', game, query],
    queryFn: () => api.get<Refs>(`/admin/games/${game}/refs?q=${encodeURIComponent(query)}`),
  });
}

function useSave() {
  const errorText = useErrorMessage();
  const t = useTranslations('admin.common');
  return async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn();
      toast.success(t('saved'));
      after?.();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
}

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** Поля значения приза по типу (общие для колеса и промокода). */
function ValueFields({
  game,
  type,
  value,
  onChange,
}: {
  game: string;
  type: string;
  value: {
    amount?: number | null;
    percent?: number | null;
    maxAmount?: number | null;
    caseId?: string | null;
    itemId?: string | null;
  };
  onChange: (patch: Partial<typeof value>) => void;
}) {
  const t = useTranslations('admin.bonuses');
  const [itemQ, setItemQ] = useState('');
  const refs = useRefs(game, itemQ);
  if (type === 'balance') {
    return (
      <Input
        value={value.amount ?? ''}
        onChange={(e) => onChange({ amount: num(e.target.value.replace(/\D/g, '')) })}
        placeholder={t('amount')}
        aria-label={t('amount')}
        className="h-9 w-28"
      />
    );
  }
  if (type === 'deposit_bonus') {
    return (
      <span className="flex gap-1.5">
        <Input
          value={
            value.percent !== null && value.percent !== undefined
              ? String(Math.round(value.percent * 1000) / 10)
              : ''
          }
          onChange={(e) => {
            const v = num(e.target.value);
            onChange({ percent: v === null ? null : v / 100 });
          }}
          placeholder={`${t('percent')}, %`}
          aria-label={t('percent')}
          className="h-9 w-20"
        />
        <Input
          value={value.maxAmount ?? ''}
          onChange={(e) => onChange({ maxAmount: num(e.target.value.replace(/\D/g, '')) })}
          placeholder={t('maxAmount')}
          aria-label={t('maxAmount')}
          className="h-9 w-28"
        />
      </span>
    );
  }
  if (type === 'free_case') {
    return (
      <Select
        value={value.caseId ?? ''}
        onChange={(e) => onChange({ caseId: e.target.value || null })}
        aria-label={t('case')}
      >
        <option value="">—</option>
        {(refs.data?.cases ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.price}
          </option>
        ))}
      </Select>
    );
  }
  if (type === 'item') {
    return (
      <span className="flex gap-1.5">
        <Input
          value={itemQ}
          onChange={(e) => setItemQ(e.target.value)}
          placeholder={t('item')}
          aria-label={t('item')}
          className="h-9 w-32"
        />
        <Select
          value={value.itemId ?? ''}
          onChange={(e) => onChange({ itemId: e.target.value || null })}
          aria-label={t('item')}
          className="max-w-[220px]"
        >
          <option value="">—</option>
          {(refs.data?.items ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.price}
            </option>
          ))}
        </Select>
      </span>
    );
  }
  return null;
}

// ---------- Колесо ----------

function toPrizeBody(p: AdminWheelPrizeDto): AdminWheelPrizeBody {
  return {
    type: p.type,
    amount: p.amount,
    itemId: p.itemId,
    caseId: p.caseId,
    percent: p.percent,
    maxAmount: p.maxAmount,
    weight: p.weight,
    label: p.label,
    color: p.color,
    sortOrder: p.sortOrder,
    isActive: p.isActive,
  };
}

function PrizeRow({
  game,
  initial,
  total,
  onSave,
}: {
  game: string;
  initial: AdminWheelPrizeBody & {
    id?: string;
    itemName?: string | null;
    caseName?: string | null;
  };
  total: number;
  onSave: (body: AdminWheelPrizeBody) => Promise<void>;
}) {
  const t = useTranslations('admin.bonuses');
  const tc = useTranslations('admin.common');
  const [b, setB] = useState<AdminWheelPrizeBody>(initial);
  const p = total > 0 && b.isActive ? b.weight / total : 0;
  return (
    <div className="clip-cut flex flex-wrap items-center gap-2 bg-surface-2 p-2.5 [--cut:6px]">
      <input
        type="color"
        value={b.color}
        onChange={(e) => setB({ ...b, color: e.target.value.toUpperCase() })}
        className="h-9 w-9 cursor-pointer bg-transparent"
        aria-label={t('color')}
      />
      <Input
        value={b.label}
        onChange={(e) => setB({ ...b, label: e.target.value })}
        aria-label={t('label')}
        className="h-9 w-40"
      />
      <Select
        value={b.type}
        onChange={(e) => setB({ ...b, type: e.target.value as PrizeType })}
        aria-label="type"
      >
        {PRIZE_TYPES.map((x) => (
          <option key={x} value={x}>
            {t(`prizeTypes.${x}`)}
          </option>
        ))}
      </Select>
      <ValueFields
        game={game}
        type={b.type}
        value={b}
        onChange={(patch) => setB({ ...b, ...patch })}
      />
      {(initial.itemName || initial.caseName) && (
        <span className="text-xs text-dim">{initial.itemName ?? initial.caseName}</span>
      )}
      <span className="flex items-center gap-1 text-xs text-muted">
        {t('weight')}
        <Input
          value={String(b.weight)}
          onChange={(e) =>
            setB({ ...b, weight: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })
          }
          aria-label={t('weight')}
          className="h-9 w-20"
        />
      </span>
      <span className="w-16 text-right text-xs tabular text-accent" title={t('probability')}>
        {(p * 100).toFixed(2)}%
      </span>
      <Input
        value={String(b.sortOrder)}
        onChange={(e) => setB({ ...b, sortOrder: Number(e.target.value.replace(/\D/g, '')) || 0 })}
        aria-label={t('order')}
        className="h-9 w-14"
      />
      <Switch checked={b.isActive} onChange={(v) => setB({ ...b, isActive: v })} />
      <Button size="sm" variant="secondary" onClick={() => void onSave(b)}>
        {initial.id ? tc('save') : tc('add')}
      </Button>
    </div>
  );
}

function WheelTab() {
  const t = useTranslations('admin.bonuses');
  const config = useConfig();
  const qc = useQueryClient();
  const save = useSave();
  const [game, setGame] = useState(config.defaultGame);
  const list = useQuery({
    queryKey: ['admin', 'wheel', game],
    queryFn: () => api.get<AdminWheelPrizeDto[]>(`/admin/games/${game}/wheel-prizes`),
  });
  const prizes = list.data ?? [];
  const total = prizes.filter((p) => p.isActive).reduce((a, p) => a + p.weight, 0);
  const ev = prizes
    .filter((p) => p.isActive && p.type === 'balance')
    .reduce((a, p) => a + (p.weight / Math.max(1, total)) * (p.amount ?? 0), 0);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'wheel', game] });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GameSelect value={game} onChange={setGame} />
        <span className="text-xs text-muted">
          {t('evPerSpin')}: <GemAmount value={Math.round(ev * 10) / 10} size="xs" />
        </span>
      </div>
      <div className="space-y-1.5" key={game}>
        {prizes.map((p) => (
          <PrizeRow
            key={`${p.id}-${p.weight}-${p.isActive}`}
            game={game}
            initial={{ ...toPrizeBody(p), id: p.id, itemName: p.itemName, caseName: p.caseName }}
            total={total}
            onSave={(b) =>
              save(() => api.put(`/admin/games/${game}/wheel-prizes/${p.id}`, b), refresh)
            }
          />
        ))}
        <PrizeRow
          key={`new-${prizes.length}`}
          game={game}
          initial={{
            type: 'balance',
            amount: 10,
            weight: 50,
            label: '10',
            color: '#2A2D36',
            sortOrder: prizes.length,
            isActive: true,
          }}
          total={total}
          onSave={(b) => save(() => api.post(`/admin/games/${game}/wheel-prizes`, b), refresh)}
        />
      </div>
    </div>
  );
}

// ---------- Промокоды ----------

const EMPTY_PROMO: AdminPromoBody = {
  code: '',
  type: 'balance',
  amount: 100,
  perUserLimit: 1,
  isActive: true,
};

function PromoTab() {
  const t = useTranslations('admin.bonuses');
  const tp = useTranslations('admin.bonuses.promo');
  const tc = useTranslations('admin.common');
  const config = useConfig();
  const qc = useQueryClient();
  const save = useSave();
  const list = useQuery({
    queryKey: ['admin', 'promos'],
    queryFn: () => api.get<AdminPromoDto[]>('/admin/promo-codes'),
  });
  const partners = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: () => api.get<AdminPartnerDto[]>('/admin/partners'),
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [b, setB] = useState<AdminPromoBody>(EMPTY_PROMO);
  const refGame = b.game ?? config.defaultGame;
  const load = (p: AdminPromoDto) => {
    setEditId(p.id);
    setB({
      code: p.code,
      type: p.type,
      amount: p.amount,
      percent: p.percent,
      maxAmount: p.maxAmount,
      caseId: p.caseId,
      itemId: p.itemId,
      game: p.game,
      totalLimit: p.totalLimit,
      perUserLimit: p.perUserLimit,
      startsAt: p.startsAt,
      expiresAt: p.expiresAt,
      minDepositGems: p.minDepositGems,
      minDepositPeriodDays: p.minDepositPeriodDays,
      newUsersMaxAgeHours: p.newUsersMaxAgeHours,
      partnerId: p.partnerId,
      isActive: p.isActive,
    });
  };
  const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\D/g, '')));
  const submit = () =>
    save(
      () =>
        editId ? api.put(`/admin/promo-codes/${editId}`, b) : api.post('/admin/promo-codes', b),
      () => {
        setEditId(null);
        setB(EMPTY_PROMO);
        void qc.invalidateQueries({ queryKey: ['admin', 'promos'] });
      },
    );
  const dateVal = (iso?: string | null) => (iso ? iso.slice(0, 16) : '');
  const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="font-semibold">{editId ? `${tc('edit')}: ${b.code}` : tp('new')}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={tp('code')} htmlFor="p-code">
            <Input
              id="p-code"
              value={b.code}
              onChange={(e) =>
                setB({ ...b, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })
              }
              className="h-10 font-mono"
            />
          </Field>
          <Field label={tp('type')} htmlFor="p-type">
            <Select
              id="p-type"
              value={b.type}
              onChange={(e) => setB({ ...b, type: e.target.value as AdminPromoBody['type'] })}
              className="w-full"
            >
              {PROMO_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`prizeTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tp('game')} htmlFor="p-game">
            <Select
              id="p-game"
              value={b.game ?? ''}
              onChange={(e) => setB({ ...b, game: e.target.value || null })}
              className="w-full"
            >
              <option value="">{tp('anyGame')}</option>
              {config.games.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tp('partner')} htmlFor="p-partner">
            <Select
              id="p-partner"
              value={b.partnerId ?? ''}
              onChange={(e) => setB({ ...b, partnerId: e.target.value || null })}
              className="w-full"
            >
              <option value="">{tp('noPartner')}</option>
              {(partners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ValueFields
            game={refGame}
            type={b.type}
            value={b}
            onChange={(patch) => setB({ ...b, ...patch })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Field label={tp('limit')} htmlFor="p-limit">
            <Input
              id="p-limit"
              value={b.totalLimit ?? ''}
              onChange={(e) => setB({ ...b, totalLimit: intOrNull(e.target.value) })}
              className="h-10"
            />
          </Field>
          <Field label={tp('perUser')} htmlFor="p-per">
            <Input
              id="p-per"
              value={String(b.perUserLimit)}
              onChange={(e) =>
                setB({ ...b, perUserLimit: Math.max(1, intOrNull(e.target.value) ?? 1) })
              }
              className="h-10"
            />
          </Field>
          <Field label={tp('starts')} htmlFor="p-start">
            <Input
              id="p-start"
              type="datetime-local"
              value={dateVal(b.startsAt)}
              onChange={(e) => setB({ ...b, startsAt: toIso(e.target.value) })}
              className="h-10"
            />
          </Field>
          <Field label={tp('expires')} htmlFor="p-exp">
            <Input
              id="p-exp"
              type="datetime-local"
              value={dateVal(b.expiresAt)}
              onChange={(e) => setB({ ...b, expiresAt: toIso(e.target.value) })}
              className="h-10"
            />
          </Field>
          <Field label={tp('minDeposit')} htmlFor="p-min">
            <Input
              id="p-min"
              value={b.minDepositGems ?? ''}
              onChange={(e) => setB({ ...b, minDepositGems: intOrNull(e.target.value) })}
              className="h-10"
            />
          </Field>
          <Field label={tp('minDepositDays')} htmlFor="p-days">
            <Input
              id="p-days"
              value={b.minDepositPeriodDays ?? ''}
              onChange={(e) => setB({ ...b, minDepositPeriodDays: intOrNull(e.target.value) })}
              className="h-10"
            />
          </Field>
          <Field label={tp('newUsers')} htmlFor="p-new">
            <Input
              id="p-new"
              value={b.newUsersMaxAgeHours ?? ''}
              onChange={(e) => setB({ ...b, newUsersMaxAgeHours: intOrNull(e.target.value) })}
              className="h-10"
            />
          </Field>
          <div className="flex items-end pb-2">
            <Switch
              checked={b.isActive}
              onChange={(v) => setB({ ...b, isActive: v })}
              label={tc('active')}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={b.code.length < 3}
            onClick={() => void submit()}
            data-testid="admin-promo-save"
          >
            {editId ? tc('save') : tc('create')}
          </Button>
          {editId && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditId(null);
                setB(EMPTY_PROMO);
              }}
            >
              {tc('cancel')}
            </Button>
          )}
        </div>
      </Card>
      <AdminTable
        rows={list.data ?? []}
        rowKey={(p) => p.id}
        onRowClick={load}
        columns={[
          {
            key: 'code',
            title: tp('code'),
            render: (p) => <span className="font-mono font-semibold">{p.code}</span>,
          },
          {
            key: 'type',
            title: tp('type'),
            className: 'text-xs',
            render: (p) => t(`prizeTypes.${p.type}`),
          },
          {
            key: 'value',
            title: '',
            className: 'text-xs',
            render: (p) =>
              p.type === 'balance' ? (
                <GemAmount value={p.amount ?? 0} size="xs" />
              ) : p.type === 'deposit_bonus' ? (
                `+${Math.round((p.percent ?? 0) * 100)}%`
              ) : (
                '—'
              ),
          },
          {
            key: 'used',
            title: tp('used'),
            className: 'text-right tabular',
            render: (p) => `${p.activationsCount}${p.totalLimit ? ` / ${p.totalLimit}` : ''}`,
          },
          { key: 'game', title: tp('game'), className: 'text-xs', render: (p) => p.game ?? '—' },
          {
            key: 'partner',
            title: tp('partner'),
            className: 'text-xs',
            render: (p) => p.partnerName ?? '—',
          },
          {
            key: 'exp',
            title: tp('expires'),
            className: 'text-xs text-muted',
            render: (p) => fmtDate(p.expiresAt),
          },
          {
            key: 'active',
            title: '',
            render: (p) => (
              <Badge tone={p.isActive ? 'soft' : 'neutral'}>
                {p.isActive ? tc('active') : tc('inactive')}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}

// ---------- Партнёры ----------

function PartnersTab() {
  const t = useTranslations('admin.bonuses.partner');
  const tc = useTranslations('admin.common');
  const qc = useQueryClient();
  const save = useSave();
  const list = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: () => api.get<AdminPartnerDto[]>('/admin/partners'),
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contacts: '', note: '' });
  const submit = () =>
    save(
      () =>
        editId
          ? api.put(`/admin/partners/${editId}`, {
              name: form.name,
              contacts: form.contacts || null,
              note: form.note || null,
            })
          : api.post('/admin/partners', {
              name: form.name,
              contacts: form.contacts || null,
              note: form.note || null,
            }),
      () => {
        setEditId(null);
        setForm({ name: '', contacts: '', note: '' });
        void qc.invalidateQueries({ queryKey: ['admin', 'partners'] });
      },
    );
  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field label={t('name')} htmlFor="pt-name">
          <Input
            id="pt-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-10"
          />
        </Field>
        <Field label={t('contacts')} htmlFor="pt-contacts">
          <Input
            id="pt-contacts"
            value={form.contacts}
            onChange={(e) => setForm({ ...form, contacts: e.target.value })}
            className="h-10"
          />
        </Field>
        <Field label={t('note')} htmlFor="pt-note">
          <Input
            id="pt-note"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="h-10"
          />
        </Field>
        <Button disabled={form.name.trim().length < 2} onClick={() => void submit()}>
          {editId ? tc('save') : t('new')}
        </Button>
      </Card>
      <AdminTable
        rows={list.data ?? []}
        rowKey={(p) => p.id}
        onRowClick={(p) => {
          setEditId(p.id);
          setForm({ name: p.name, contacts: p.contacts ?? '', note: p.note ?? '' });
        }}
        columns={[
          {
            key: 'name',
            title: t('name'),
            render: (p) => <span className="font-semibold">{p.name}</span>,
          },
          {
            key: 'codes',
            title: t('codes'),
            className: 'text-right tabular',
            render: (p) => p.stats.promoCodes,
          },
          {
            key: 'acts',
            title: t('activations'),
            className: 'text-right tabular',
            render: (p) => p.stats.activations,
          },
          {
            key: 'users',
            title: t('users'),
            className: 'text-right tabular',
            render: (p) => p.stats.users,
          },
          {
            key: 'dep',
            title: t('depositors'),
            className: 'text-right tabular',
            render: (p) => p.stats.depositors,
          },
          {
            key: 'gems',
            title: t('deposits'),
            className: 'text-right',
            render: (p) => <GemAmount value={p.stats.depositsGems} size="sm" />,
          },
          {
            key: 'contacts',
            title: t('contacts'),
            className: 'text-xs text-dim',
            render: (p) => p.contacts ?? '',
          },
        ]}
      />
    </div>
  );
}

// ---------- Уровни ----------

function LevelsTab() {
  const t = useTranslations('admin.bonuses.levels');
  const tc = useTranslations('admin.common');
  const save = useSave();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['levels'], queryFn: () => api.get<LevelRowDto[]>('/levels') });
  const [rows, setRows] = useState<LevelRowDto[]>([]);
  useEffect(() => {
    if (list.data) setRows(list.data);
  }, [list.data]);
  const upd = (i: number, patch: Partial<LevelRowDto>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updReward = (i: number, patch: Record<string, unknown>) =>
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const reward = { ...(r.reward ?? {}), ...patch } as Record<string, unknown>;
        for (const k of Object.keys(reward))
          if (reward[k] === undefined || reward[k] === null || reward[k] === 0) delete reward[k];
        return {
          ...r,
          reward: Object.keys(reward).length ? (reward as LevelRowDto['reward']) : null,
        };
      }),
    );
  const intVal = (v: string) => Number(v.replace(/\D/g, '')) || 0;
  return (
    <div className="space-y-3">
      <div className="max-h-[560px] overflow-y-auto">
        <AdminTable
          rows={rows.map((r, i) => ({ ...r, i }))}
          rowKey={(r) => String(r.level)}
          columns={[
            { key: 'level', title: t('level'), className: 'tabular', render: (r) => r.level },
            {
              key: 'xp',
              title: t('xp'),
              render: (r) => (
                <Input
                  value={String(r.xpRequired)}
                  onChange={(e) => upd(r.i, { xpRequired: intVal(e.target.value) })}
                  className="h-8 w-28"
                  aria-label={t('xp')}
                />
              ),
            },
            {
              key: 'balance',
              title: t('balance'),
              render: (r) => (
                <Input
                  value={String(r.reward?.balance ?? '')}
                  onChange={(e) => updReward(r.i, { balance: intVal(e.target.value) })}
                  className="h-8 w-24"
                  aria-label={t('balance')}
                />
              ),
            },
            {
              key: 'spins',
              title: t('spins'),
              render: (r) => (
                <Input
                  value={String(r.reward?.wheelSpins ?? '')}
                  onChange={(e) => updReward(r.i, { wheelSpins: intVal(e.target.value) })}
                  className="h-8 w-16"
                  aria-label={t('spins')}
                />
              ),
            },
            {
              key: 'dep',
              title: t('depositPercent'),
              render: (r) => (
                <span className="flex gap-1">
                  <Input
                    value={
                      r.reward?.depositBonus
                        ? String(Math.round(r.reward.depositBonus.percent * 100))
                        : ''
                    }
                    onChange={(e) => {
                      const p = intVal(e.target.value);
                      updReward(r.i, {
                        depositBonus: p
                          ? {
                              percent: p / 100,
                              maxAmount: r.reward?.depositBonus?.maxAmount ?? 1000,
                            }
                          : undefined,
                      });
                    }}
                    className="h-8 w-14"
                    aria-label={t('depositPercent')}
                  />
                  <Input
                    value={r.reward?.depositBonus ? String(r.reward.depositBonus.maxAmount) : ''}
                    onChange={(e) =>
                      r.reward?.depositBonus &&
                      updReward(r.i, {
                        depositBonus: {
                          percent: r.reward.depositBonus.percent,
                          maxAmount: intVal(e.target.value),
                        },
                      })
                    }
                    className="h-8 w-20"
                    aria-label={t('depositMax')}
                  />
                </span>
              ),
            },
            {
              key: 'rm',
              title: '',
              render: (r) =>
                r.i === rows.length - 1 && rows.length > 1 ? (
                  <button
                    type="button"
                    className="text-dim hover:text-danger"
                    onClick={() => setRows((rs) => rs.slice(0, -1))}
                    aria-label="remove"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null,
            },
          ]}
        />
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const last = rows[rows.length - 1];
            setRows((rs) => [
              ...rs,
              {
                level: (last?.level ?? 0) + 1,
                xpRequired: Math.round((last?.xpRequired ?? 0) * 1.1 + 100),
                reward: null,
              },
            ]);
          }}
        >
          <Plus size={14} /> {t('add')}
        </Button>
        <Button
          onClick={() =>
            void save(
              () => api.put('/admin/levels', { levels: rows }),
              () => void qc.invalidateQueries({ queryKey: ['levels'] }),
            )
          }
        >
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}

// ---------- Лидерборды ----------

function LeaderboardCard({ lb, onSaved }: { lb: AdminLeaderboardDto; onSaved: () => void }) {
  const t = useTranslations('admin.bonuses.leaderboards');
  const tc = useTranslations('admin.common');
  const save = useSave();
  const [prizes, setPrizes] = useState(lb.prizes);
  const [active, setActive] = useState(lb.isActive);
  const upd = (i: number, k: 'from' | 'to' | 'amount', v: string) =>
    setPrizes((ps) =>
      ps.map((p, j) => (j === i ? { ...p, [k]: Number(v.replace(/\D/g, '')) || 0 } : p)),
    );
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {lb.game} · {t(`periods.${lb.period}`)}
        </span>
        <Switch checked={active} onChange={setActive} label={tc('active')} />
      </div>
      <div className="space-y-1.5">
        {prizes.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-muted">
            {t('from')}
            <Input
              value={String(p.from)}
              onChange={(e) => upd(i, 'from', e.target.value)}
              className="h-8 w-14"
              aria-label={t('from')}
            />
            {t('to')}
            <Input
              value={String(p.to)}
              onChange={(e) => upd(i, 'to', e.target.value)}
              className="h-8 w-14"
              aria-label={t('to')}
            />
            <Input
              value={String(p.amount)}
              onChange={(e) => upd(i, 'amount', e.target.value)}
              className="h-8 w-24"
              aria-label="amount"
            />
            <button
              type="button"
              className="text-dim hover:text-danger"
              onClick={() => setPrizes((ps) => ps.filter((_, j) => j !== i))}
              aria-label="remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const last = prizes[prizes.length - 1];
            setPrizes((ps) => [
              ...ps,
              { from: (last?.to ?? 0) + 1, to: (last?.to ?? 0) + 1, amount: 10 },
            ]);
          }}
        >
          <Plus size={14} /> {t('addPrize')}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void save(
              () => api.put(`/admin/leaderboards/${lb.id}`, { prizes, isActive: active }),
              onSaved,
            )
          }
        >
          {tc('save')}
        </Button>
      </div>
    </Card>
  );
}

function LeaderboardsTab() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'leaderboards'],
    queryFn: () => api.get<AdminLeaderboardDto[]>('/admin/leaderboards'),
  });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(list.data ?? []).map((lb) => (
        <LeaderboardCard
          key={lb.id}
          lb={lb}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'leaderboards'] })}
        />
      ))}
    </div>
  );
}

// ---------- Достижения ----------

function AchievementRow({ a, onSaved }: { a: AdminAchievementDto; onSaved: () => void }) {
  const tc = useTranslations('admin.common');
  const save = useSave();
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description);
  const [target, setTarget] = useState(String(a.target));
  const [active, setActive] = useState(a.isActive);
  return (
    <div className="clip-cut flex flex-wrap items-center gap-2 bg-surface-2 p-2.5 [--cut:6px]">
      <span className="w-28 font-mono text-[11px] text-dim">{a.code}</span>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9 w-40"
        aria-label="name"
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="h-9 min-w-0 flex-1"
        aria-label="description"
      />
      <span className="text-[11px] text-dim">{a.conditionType}</span>
      <Input
        value={target}
        onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
        className="h-9 w-24"
        aria-label="target"
      />
      <Switch checked={active} onChange={setActive} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          void save(
            () =>
              api.patch(`/admin/achievements/${a.id}`, {
                name,
                description,
                target: Number(target) || 1,
                isActive: active,
              }),
            onSaved,
          )
        }
      >
        {tc('save')}
      </Button>
    </div>
  );
}

function AchievementsTab() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'achievements'],
    queryFn: () => api.get<AdminAchievementDto[]>('/admin/achievements'),
  });
  return (
    <div className="space-y-1.5">
      {(list.data ?? []).map((a) => (
        <AchievementRow
          key={a.id}
          a={a}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'achievements'] })}
        />
      ))}
    </div>
  );
}

export function AdminBonuses() {
  const t = useTranslations('admin.bonuses');
  return (
    <div className="space-y-4">
      <SectionTitle>{t('title')}</SectionTitle>
      <Tabs defaultValue="wheel">
        <TabsList>
          {(['wheel', 'promo', 'partners', 'levels', 'leaderboards', 'achievements'] as const).map(
            (k) => (
              <TabsTrigger key={k} value={k}>
                {t(`tabs.${k}`)}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <TabsContent value="wheel" className="pt-4">
          <WheelTab />
        </TabsContent>
        <TabsContent value="promo" className="pt-4">
          <PromoTab />
        </TabsContent>
        <TabsContent value="partners" className="pt-4">
          <PartnersTab />
        </TabsContent>
        <TabsContent value="levels" className="pt-4">
          <LevelsTab />
        </TabsContent>
        <TabsContent value="leaderboards" className="pt-4">
          <LeaderboardsTab />
        </TabsContent>
        <TabsContent value="achievements" className="pt-4">
          <AchievementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
