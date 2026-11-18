'use client';

import type { AdminItemDto, AdminPageDto, AdminRarityDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { GameSelect } from './cases';
import { AdminTable, Pager, Select, Switch, useDebounced } from './ui';

type Flag = 'isActive' | 'isWithdrawable' | 'inUpgrade' | 'inContract';
const FLAGS: Flag[] = ['isActive', 'isWithdrawable', 'inUpgrade', 'inContract'];

function PriceCell({
  item,
  onSave,
}: {
  item: AdminItemDto;
  onSave: (price: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(item.price));
  const dirty = value !== String(item.price);
  return (
    <span className="flex items-center justify-end gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty && value) void onSave(Number(value));
        }}
        onBlur={() => {
          if (dirty && value) void onSave(Number(value));
        }}
        aria-label="price"
        className="h-8 w-24 text-right tabular"
      />
    </span>
  );
}

function ItemsTab({ game }: { game: string }) {
  const t = useTranslations('admin.catalog');
  const tc = useTranslations('admin.common');
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<'percent' | 'set'>('percent');
  const [value, setValue] = useState('');
  const query = useDebounced(q.trim());
  const rarities = useQuery({
    queryKey: ['admin', 'rarities', game],
    queryFn: () => api.get<AdminRarityDto[]>(`/admin/games/${game}/rarities`),
  });
  const list = useQuery({
    queryKey: ['admin', 'items', game, query, rarity, page],
    queryFn: () =>
      api.get<AdminPageDto<AdminItemDto>>(
        `/admin/games/${game}/items?page=${page}&pageSize=30${query ? `&q=${encodeURIComponent(query)}` : ''}${rarity ? `&rarity=${rarity}` : ''}`,
      ),
  });
  const patch = async (id: string, body: Partial<Record<Flag, boolean>> & { price?: number }) => {
    try {
      await api.patch(`/admin/items/${id}`, body);
      void qc.invalidateQueries({ queryKey: ['admin', 'items', game] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const bulk = async () => {
    const v = Number(value.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    try {
      const res = await api.post<{ updated: number }>(`/admin/games/${game}/items/bulk-price`, {
        mode,
        value: v,
        ...(query ? { q: query } : {}),
        ...(rarity ? { rarity } : {}),
      });
      toast.success(t('bulkDone', { count: res.updated }));
      setValue('');
      void qc.invalidateQueries({ queryKey: ['admin', 'items', game] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={tc('search')}
          className="h-10 max-w-xs"
          aria-label="search"
        />
        <Select
          value={rarity}
          onChange={(e) => {
            setRarity(e.target.value);
            setPage(1);
          }}
          aria-label={t('rarity')}
        >
          <option value="">{t('allRarities')}</option>
          {(rarities.data ?? []).map((r) => (
            <option key={r.id} value={r.code}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm font-semibold">{t('bulk')}</span>
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'percent' | 'set')}
          aria-label={t('bulk')}
        >
          <option value="percent">{t('bulkMode.percent')}</option>
          <option value="set">{t('bulkMode.set')}</option>
        </Select>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('bulkValue')}
          aria-label={t('bulkValue')}
          className="h-10 w-28"
        />
        <Button variant="secondary" disabled={!value} onClick={() => void bulk()}>
          {t('bulkApply')}
        </Button>
        <span className="text-xs text-dim">{list.data ? `${list.data.total}` : ''}</span>
      </Card>
      <AdminTable
        rows={list.data?.items ?? []}
        rowKey={(i) => i.id}
        columns={[
          {
            key: 'name',
            title: t('name'),
            render: (i) => (
              <span className="flex items-center gap-2">
                {i.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" className="h-7 w-12 object-contain" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{i.fullName}</span>
                  <span className="text-[11px]" style={{ color: i.rarity.color }}>
                    {i.rarity.name}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: 'price',
            title: t('price'),
            className: 'text-right',
            render: (i) => (
              <PriceCell
                key={`${i.id}-${i.price}`}
                item={i}
                onSave={(price) => patch(i.id, { price })}
              />
            ),
          },
          ...FLAGS.map((f) => ({
            key: f,
            title: t(`flags.${f}`),
            className: 'text-center',
            render: (i: AdminItemDto) => (
              <Switch checked={i[f]} onChange={(v) => void patch(i.id, { [f]: v })} />
            ),
          })),
        ]}
      />
      {list.data && (
        <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
      )}
    </div>
  );
}

function ImportTab({ game }: { game: string }) {
  const t = useTranslations('admin.catalog');
  const tc = useTranslations('admin.common');
  const errorText = useErrorMessage();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    if (!file) return;
    setBusy('import');
    try {
      const csv = await file.text();
      const res = await api.post<{ created: number; updated: number; errors: unknown[] }>(
        `/admin/catalog/${game}/import`,
        { fileName: file.name, csv },
      );
      toast.success(
        t('importDone', { created: res.created, updated: res.updated, errors: res.errors.length }),
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'items', game] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setBusy('refresh');
    try {
      await api.post(`/admin/catalog/${game}/refresh-prices`);
      toast.success(tc('saved'));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm text-muted">{t('importHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label={t('importFile')}
          className="text-sm text-muted file:mr-3 file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-text"
        />
        <Button loading={busy === 'import'} disabled={!file} onClick={() => void run()}>
          <Upload size={16} /> {t('importRun')}
        </Button>
        <Button variant="secondary" loading={busy === 'refresh'} onClick={() => void refresh()}>
          <RefreshCw size={16} /> {t('refreshPrices')}
        </Button>
      </div>
    </Card>
  );
}

function RaritiesTab({ game }: { game: string }) {
  const t = useTranslations('admin.catalog');
  const tc = useTranslations('admin.common');
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const list = useQuery({
    queryKey: ['admin', 'rarities', game],
    queryFn: () => api.get<AdminRarityDto[]>(`/admin/games/${game}/rarities`),
  });
  const [edits, setEdits] = useState<Record<number, Partial<AdminRarityDto>>>({});
  const save = async (r: AdminRarityDto) => {
    const e = edits[r.id];
    if (!e) return;
    try {
      await api.patch(`/admin/rarities/${r.id}`, e);
      setEdits((x) => ({ ...x, [r.id]: undefined as unknown as Partial<AdminRarityDto> }));
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'rarities', game] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <AdminTable
      rows={list.data ?? []}
      rowKey={(r) => String(r.id)}
      columns={[
        { key: 'code', title: 'code', className: 'font-mono text-xs', render: (r) => r.code },
        {
          key: 'name',
          title: t('name'),
          render: (r) => (
            <Input
              value={edits[r.id]?.name ?? r.name}
              onChange={(e) =>
                setEdits((x) => ({ ...x, [r.id]: { ...x[r.id], name: e.target.value } }))
              }
              className="h-8"
              aria-label={t('name')}
            />
          ),
        },
        {
          key: 'color',
          title: t('color'),
          render: (r) => (
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={edits[r.id]?.color ?? r.color}
                onChange={(e) =>
                  setEdits((x) => ({
                    ...x,
                    [r.id]: { ...x[r.id], color: e.target.value.toUpperCase() },
                  }))
                }
                className="h-8 w-10 cursor-pointer bg-transparent"
                aria-label={t('color')}
              />
              <span className="font-mono text-xs">{edits[r.id]?.color ?? r.color}</span>
            </span>
          ),
        },
        {
          key: 'order',
          title: t('order'),
          render: (r) => (
            <Input
              value={String(edits[r.id]?.sortOrder ?? r.sortOrder)}
              onChange={(e) =>
                setEdits((x) => ({
                  ...x,
                  [r.id]: { ...x[r.id], sortOrder: Number(e.target.value.replace(/\D/g, '')) || 0 },
                }))
              }
              className="h-8 w-20"
              aria-label={t('order')}
            />
          ),
        },
        {
          key: 'save',
          title: '',
          render: (r) => (
            <Button
              size="sm"
              variant="secondary"
              disabled={!edits[r.id]}
              onClick={() => void save(r)}
            >
              {tc('save')}
            </Button>
          ),
        },
      ]}
    />
  );
}

export function AdminCatalog() {
  const t = useTranslations('admin.catalog');
  const config = useConfig();
  const [game, setGame] = useState(config.defaultGame);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('title')}</SectionTitle>
        <GameSelect value={game} onChange={setGame} />
      </div>
      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">{t('items')}</TabsTrigger>
          <TabsTrigger value="rarities">{t('rarities')}</TabsTrigger>
          <TabsTrigger value="import">{t('import')}</TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="pt-4">
          <ItemsTab key={game} game={game} />
        </TabsContent>
        <TabsContent value="rarities" className="pt-4">
          <RaritiesTab key={game} game={game} />
        </TabsContent>
        <TabsContent value="import" className="pt-4">
          <ImportTab key={game} game={game} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
