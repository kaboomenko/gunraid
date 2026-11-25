'use client';

import {
  caseRtp,
  expectedValue,
  fitOddsToRtp,
  ODDS_TOTAL,
  oddsToPercent,
  percentToOdds,
} from '@gunraid/game-core';
import type {
  AdminCaseBody,
  AdminCaseCategoryDto,
  AdminCaseDetailDto,
  AdminCaseRowDto,
  AdminItemDto,
  AdminPageDto,
  ItemDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Scale, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { GemAmount } from '@/components/ui/gem';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import {
  AdminSection,
  AdminTable,
  Select,
  Switch,
  TextArea,
  fmtDate,
  pct,
  useDebounced,
} from './ui';

export function GameSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const config = useConfig();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="game">
      {config.games.map((g) => (
        <option key={g.code} value={g.code}>
          {g.name}
        </option>
      ))}
    </Select>
  );
}

export function AdminCases() {
  const t = useTranslations('admin.cases');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const config = useConfig();
  const [game, setGame] = useState(config.defaultGame);
  const list = useQuery({
    queryKey: ['admin', 'cases', game],
    queryFn: () => api.get<AdminCaseRowDto[]>(`/admin/games/${game}/cases`),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('title')}</SectionTitle>
        <div className="flex gap-2">
          <GameSelect value={game} onChange={setGame} />
          <Button asChild>
            <Link href={`/admin/cases/new?game=${game}`}>
              <Plus size={16} /> {t('new')}
            </Link>
          </Button>
        </div>
      </div>
      <AdminTable
        rows={list.data ?? []}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/admin/cases/${c.id}?game=${game}`)}
        columns={[
          {
            key: 'name',
            title: '',
            render: (c) => (
              <span className="flex items-center gap-2">
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="h-9 w-9 object-contain" />
                )}
                <span className="font-semibold">{c.name}</span>
              </span>
            ),
          },
          {
            key: 'cat',
            title: t('category'),
            className: 'text-xs text-muted',
            render: (c) => c.categoryCode,
          },
          {
            key: 'price',
            title: t('price'),
            className: 'text-right',
            render: (c) => <GemAmount value={c.price} size="sm" />,
          },
          {
            key: 'rtp',
            title: t('rtp'),
            className: 'text-right tabular',
            render: (c) => (
              <span className={cn(c.rtp !== null && c.rtp > 1 && 'text-danger')}>{pct(c.rtp)}</span>
            ),
          },
          {
            key: 'items',
            title: t('items'),
            className: 'text-right tabular',
            render: (c) => c.itemsCount,
          },
          {
            key: 'opened',
            title: t('opened'),
            className: 'text-right tabular',
            render: (c) => c.opened,
          },
          {
            key: 'active',
            title: tc('status'),
            render: (c) => (
              <Badge tone={c.isActive ? 'soft' : 'neutral'}>
                {c.isActive ? tc('active') : tc('inactive')}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}

interface Row {
  item: ItemDto;
  percent: string;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY: AdminCaseBody = {
  slug: '',
  name: '',
  description: null,
  imageUrl: '/media/demo/chest.svg?c1=C6FF00&c2=2A2D36',
  accentColor: '#C6FF00',
  price: 100,
  kind: 'paid',
  categoryId: 0,
  minLevel: null,
  cooldownSeconds: null,
  supplyTotal: null,
  availableFrom: null,
  availableUntil: null,
  isActive: false,
  sortOrder: 0,
};

export function AdminCaseEditor({ id, game }: { id: string | null; game: string }) {
  const t = useTranslations('admin.cases');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const detail = useQuery({
    queryKey: ['admin', 'case', id],
    enabled: Boolean(id),
    queryFn: () => api.get<AdminCaseDetailDto>(`/admin/cases/${id}`),
  });
  const categories = useQuery({
    queryKey: ['admin', 'case-categories', game],
    queryFn: () => api.get<AdminCaseCategoryDto[]>(`/admin/games/${game}/case-categories`),
  });
  const [form, setForm] = useState<AdminCaseBody>(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState('0.9');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const found = useQuery({
    queryKey: ['admin', 'items-search', game, q],
    enabled: q.length >= 2,
    queryFn: () =>
      api.get<AdminPageDto<AdminItemDto>>(
        `/admin/games/${game}/items?q=${encodeURIComponent(q)}&pageSize=8`,
      ),
  });

  useEffect(() => {
    const d = detail.data;
    if (!d) return;
    setForm({
      slug: d.slug,
      name: d.name,
      description: d.description,
      imageUrl: d.imageUrl,
      accentColor: d.accentColor,
      price: d.price,
      kind: d.kind,
      categoryId: d.categoryId,
      minLevel: d.minLevel,
      cooldownSeconds: d.cooldownSeconds,
      supplyTotal: d.supplyTotal,
      availableFrom: d.availableFrom,
      availableUntil: d.availableUntil,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
    });
    setRows(d.contents.map((c) => ({ item: c.item, percent: oddsToPercent(c.odds) })));
  }, [detail.data]);

  useEffect(() => {
    if (!form.categoryId && categories.data?.[0]) {
      setForm((f) => ({ ...f, categoryId: categories.data![0]!.id }));
    }
  }, [categories.data, form.categoryId]);

  const entries = useMemo(
    () => rows.map((r) => ({ odds: percentToOdds(r.percent || '0'), price: r.item.price })),
    [rows],
  );
  const sum = entries.reduce((a, e) => a + e.odds, 0);
  const sumOk = sum === ODDS_TOTAL && entries.every((e) => e.odds > 0);
  const rtp = caseRtp(entries, form.price);
  const ev = expectedValue(entries);

  const set = <K extends keyof AdminCaseBody>(k: K, v: AdminCaseBody[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const numOrNull = (v: string) =>
    v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0));

  const saveCase = async () => {
    setBusy('case');
    try {
      const body: AdminCaseBody = {
        ...form,
        availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : null,
        availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null,
      };
      if (id) {
        await api.put(`/admin/games/${game}/cases/${id}`, body);
        await qc.invalidateQueries({ queryKey: ['admin', 'case', id] });
      } else {
        const created = await api.post<AdminCaseDetailDto>(`/admin/games/${game}/cases`, body);
        router.replace(`/admin/cases/${created.id}?game=${game}`);
      }
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'cases'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const saveContents = async () => {
    if (!id || !sumOk) return;
    setBusy('contents');
    try {
      await api.put(`/admin/cases/${id}/contents`, {
        contents: rows.map((r) => ({ itemId: r.item.id, odds: percentToOdds(r.percent) })),
      });
      toast.success(tc('saved'));
      await qc.invalidateQueries({ queryKey: ['admin', 'case', id] });
      void qc.invalidateQueries({ queryKey: ['admin', 'cases'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const normalize = () => {
    if (!sum) return;
    const odds = entries.map((e) => Math.max(1, Math.round((e.odds / sum) * ODDS_TOTAL)));
    const diff = ODDS_TOTAL - odds.reduce((a, o) => a + o, 0);
    const maxIdx = odds.indexOf(Math.max(...odds));
    odds[maxIdx] = odds[maxIdx]! + diff;
    setRows((rs) => rs.map((r, i) => ({ ...r, percent: oddsToPercent(odds[i]!) })));
  };

  const fit = () => {
    const tr = Number(target.replace(',', '.'));
    if (!rows.length || !(tr > 0) || form.price <= 0) return;
    const odds = fitOddsToRtp(
      rows.map((r) => r.item.price),
      form.price,
      tr,
    );
    setRows((rs) => rs.map((r, i) => ({ ...r, percent: oddsToPercent(odds[i]!) })));
  };

  if (id && !detail.data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      <Link
        href="/admin/cases"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={16} /> {t('back')}
      </Link>
      <SectionTitle>{id ? form.name || t('edit') : t('new')}</SectionTitle>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t('fields.name')} htmlFor="c-name">
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.slug')} htmlFor="c-slug">
            <Input
              id="c-slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="h-10 font-mono"
            />
          </Field>
          <Field label={t('fields.kind')} htmlFor="c-kind">
            <Select
              id="c-kind"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as 'paid' | 'free')}
              className="w-full"
            >
              <option value="paid">{t('kinds.paid')}</option>
              <option value="free">{t('kinds.free')}</option>
            </Select>
          </Field>
          <Field label={t('fields.price')} htmlFor="c-price">
            <Input
              id="c-price"
              value={String(form.price)}
              disabled={form.kind === 'free'}
              onChange={(e) =>
                set(
                  'price',
                  Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)),
                )
              }
              className="h-10"
            />
          </Field>
          <Field label={t('fields.categoryId')} htmlFor="c-cat">
            <Select
              id="c-cat"
              value={form.categoryId}
              onChange={(e) => set('categoryId', Number(e.target.value))}
              className="w-full"
            >
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fields.imageUrl')} htmlFor="c-img">
            <Input
              id="c-img"
              value={form.imageUrl ?? ''}
              onChange={(e) => set('imageUrl', e.target.value || null)}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.accentColor')} htmlFor="c-color">
            <div className="flex gap-2">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
                className="h-10 w-12 cursor-pointer bg-transparent"
                aria-label={t('fields.accentColor')}
              />
              <Input
                id="c-color"
                value={form.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
                className="h-10 font-mono"
              />
            </div>
          </Field>
          <Field label={t('fields.sortOrder')} htmlFor="c-sort">
            <Input
              id="c-sort"
              value={String(form.sortOrder)}
              onChange={(e) => set('sortOrder', numOrNull(e.target.value) ?? 0)}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.minLevel')} htmlFor="c-lvl">
            <Input
              id="c-lvl"
              value={form.minLevel ?? ''}
              onChange={(e) => set('minLevel', numOrNull(e.target.value))}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.cooldownSeconds')} htmlFor="c-cd">
            <Input
              id="c-cd"
              value={form.cooldownSeconds ?? ''}
              onChange={(e) => set('cooldownSeconds', numOrNull(e.target.value))}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.supplyTotal')} htmlFor="c-supply">
            <Input
              id="c-supply"
              value={form.supplyTotal ?? ''}
              onChange={(e) => set('supplyTotal', numOrNull(e.target.value))}
              className="h-10"
            />
          </Field>
          <div className="flex items-end pb-2">
            <Switch
              checked={form.isActive}
              onChange={(v) => set('isActive', v)}
              disabled={!id || !detail.data?.revision}
              label={t('fields.isActive')}
            />
          </div>
          <Field label={t('fields.availableFrom')} htmlFor="c-from">
            <Input
              id="c-from"
              type="datetime-local"
              value={toLocalInput(form.availableFrom ?? null)}
              onChange={(e) => set('availableFrom', e.target.value || null)}
              className="h-10"
            />
          </Field>
          <Field label={t('fields.availableUntil')} htmlFor="c-until">
            <Input
              id="c-until"
              type="datetime-local"
              value={toLocalInput(form.availableUntil ?? null)}
              onChange={(e) => set('availableUntil', e.target.value || null)}
              className="h-10"
            />
          </Field>
        </div>
        <Field label={t('fields.description')} htmlFor="c-desc">
          <TextArea
            id="c-desc"
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value || null)}
          />
        </Field>
        {!detail.data?.revision && <p className="text-xs text-dim">{t('activeHint')}</p>}
        <Button
          loading={busy === 'case'}
          disabled={!form.name || !form.slug || !form.categoryId}
          onClick={() => void saveCase()}
          data-testid="admin-case-save"
        >
          {t('saveCase')}
        </Button>
      </Card>

      {id && (
        <AdminSection
          title={t('contents')}
          actions={
            detail.data?.revision && (
              <span className="text-xs text-dim">
                {t('revision', {
                  version: detail.data.revision.version,
                  date: fmtDate(detail.data.revision.createdAt),
                })}
              </span>
            )
          }
        >
          <Card className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div
                className={cn(
                  'clip-cut p-3 [--cut:6px]',
                  sumOk ? 'bg-accent-soft' : 'bg-danger/10',
                )}
              >
                <div className="text-[11px] uppercase tracking-wider text-dim">{t('sum')}</div>
                <div
                  className={cn(
                    'font-display text-xl font-bold tabular',
                    sumOk ? 'text-accent' : 'text-danger',
                  )}
                >
                  {oddsToPercent(sum)} %
                </div>
                <div className="text-[11px] text-muted">{sumOk ? t('sumOk') : t('sumBad')}</div>
              </div>
              <div className="clip-cut bg-surface-2 p-3 [--cut:6px]" data-testid="admin-case-rtp">
                <div className="text-[11px] uppercase tracking-wider text-dim">{t('rtpLive')}</div>
                <div
                  className={cn(
                    'font-display text-xl font-bold tabular',
                    rtp !== null && rtp > 1 && 'text-danger',
                  )}
                >
                  {pct(rtp, 2)}
                </div>
                <div className="text-[11px] text-muted">
                  {t('ev')}: <GemAmount value={Math.round(ev)} size="xs" />
                </div>
              </div>
              <div className="clip-cut space-y-2 bg-surface-2 p-3 [--cut:6px]">
                <div className="flex items-center gap-2">
                  <Input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    aria-label={t('fitTarget')}
                    className="h-9 w-20"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={fit}
                    disabled={!rows.length || form.price <= 0}
                  >
                    <Sparkles size={14} /> {t('fit')}
                  </Button>
                </div>
                <Button size="sm" variant="ghost" onClick={normalize} disabled={!sum}>
                  <Scale size={14} /> {t('normalize')}
                </Button>
              </div>
            </div>

            {rows.length ? (
              <ul className="space-y-1.5">
                {rows.map((r, i) => (
                  <li
                    key={r.item.id}
                    className="clip-cut flex items-center gap-3 bg-surface-2 px-3 py-2 [--cut:6px]"
                  >
                    {r.item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.item.imageUrl} alt="" className="h-8 w-14 object-contain" />
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      style={{ color: r.item.rarity.color }}
                    >
                      {r.item.fullName}
                    </span>
                    <GemAmount value={r.item.price} size="sm" />
                    <Input
                      value={r.percent}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x, j) =>
                            j === i ? { ...x, percent: e.target.value.replace(/[^\d.,]/g, '') } : x,
                          ),
                        )
                      }
                      aria-label={t('chance')}
                      className="h-9 w-28 text-right tabular"
                    />
                    <span className="text-xs text-dim">%</span>
                    <button
                      type="button"
                      className="text-dim hover:text-danger"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label={t('remove')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-dim">{t('noContents')}</p>
            )}

            <div className="space-y-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchItems')}
                aria-label={t('searchItems')}
                className="h-10"
              />
              {found.data && (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {found.data.items
                    .filter((it) => !rows.some((r) => r.item.id === it.id))
                    .map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          className="clip-cut flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left text-sm hover:bg-surface-3 [--cut:6px]"
                          onClick={() => setRows((rs) => [...rs, { item: it, percent: '0' }])}
                        >
                          <Plus size={14} className="text-accent" />
                          <span className="min-w-0 flex-1 truncate">{it.fullName}</span>
                          <GemAmount value={it.price} size="xs" />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <Button
              loading={busy === 'contents'}
              disabled={!sumOk}
              onClick={() => void saveContents()}
              data-testid="admin-case-contents-save"
            >
              {t('saveContents')}
            </Button>
          </Card>
        </AdminSection>
      )}
    </div>
  );
}
