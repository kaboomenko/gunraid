'use client';

import type { AdminSettingsDto, FxRateDto, SettingsKey } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { AdminSection, AdminTable, Select, Switch, fmtDate } from './ui';

type Value = string | number | boolean | null | number[];
const STRING_FIELDS = new Set(['supportTelegramUrl', 'defaultGame', 'code']);

function SettingsGroup({
  name,
  value,
  defaults,
  onSaved,
}: {
  name: SettingsKey;
  value: Record<string, Value>;
  defaults: Record<string, Value>;
  onSaved: () => void;
}) {
  const t = useTranslations('admin.settings');
  const tc = useTranslations('admin.common');
  const config = useConfig();
  const errorText = useErrorMessage();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);

  const toText = (v: Value): string | boolean =>
    typeof v === 'boolean' ? v : Array.isArray(v) ? v.join(', ') : v === null ? '' : String(v);
  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toText(v)])));
  }, [value]);

  const parse = (k: string, raw: string | boolean): Value => {
    const def = defaults[k];
    if (typeof raw === 'boolean') return raw;
    if (Array.isArray(def)) {
      return raw
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map((x) => Number(x.replace(',', '.')));
    }
    if (STRING_FIELDS.has(k)) return raw.trim() === '' ? null : raw.trim();
    if (raw.trim() === '') return def === null ? null : Number.NaN;
    return Number(raw.replace(',', '.'));
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.keys(value).map((k) => [k, parse(k, draft[k] ?? '')]));
      await api.put(`/admin/settings/${name}`, body);
      toast.success(tc('saved'));
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4" data-testid={`settings-${name}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold uppercase">{t(`groups.${name}`)}</h3>
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-dim hover:text-text"
          onClick={() =>
            setDraft(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, toText(v)])))
          }
        >
          <RotateCcw size={12} /> {t('reset')}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(value).map((k) => {
          const label = t.has(`fields.${k}`) ? t(`fields.${k}`) : k;
          const v = draft[k];
          if (typeof defaults[k] === 'boolean') {
            return (
              <div key={k} className="flex items-end pb-1">
                <Switch
                  checked={Boolean(v)}
                  onChange={(x) => setDraft((d) => ({ ...d, [k]: x }))}
                  label={label}
                />
              </div>
            );
          }
          if (k === 'defaultGame') {
            return (
              <Field key={k} label={label} htmlFor={`${name}-${k}`}>
                <Select
                  id={`${name}-${k}`}
                  value={String(v ?? '')}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  className="w-full"
                >
                  {config.games.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          return (
            <Field key={k} label={label} htmlFor={`${name}-${k}`}>
              <Input
                id={`${name}-${k}`}
                value={String(v ?? '')}
                placeholder={defaults[k] === null ? t('nullable') : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                className="h-10"
              />
            </Field>
          );
        })}
      </div>
      <Button size="sm" loading={busy} onClick={() => void save()}>
        {tc('save')}
      </Button>
    </Card>
  );
}

function FxRow({ r, onSaved }: { r: FxRateDto; onSaved: () => void }) {
  const tc = useTranslations('admin.common');
  const errorText = useErrorMessage();
  const [rate, setRate] = useState(r.usdRate);
  const save = async () => {
    try {
      await api.put(`/admin/fx-rates/${r.currency}`, { usdRate: rate.replace(',', '.') });
      toast.success(tc('saved'));
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <span className="flex items-center gap-2">
      <Input
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        className="h-8 w-40 font-mono"
        aria-label={r.currency}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={rate === r.usdRate}
        onClick={() => void save()}
      >
        {tc('save')}
      </Button>
    </span>
  );
}

export function AdminSettings() {
  const t = useTranslations('admin.settings');
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettingsDto>('/admin/settings'),
  });
  const fx = useQuery({
    queryKey: ['admin', 'fx'],
    queryFn: () => api.get<FxRateDto[]>('/admin/fx-rates'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
  const data = settings.data;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-sm text-muted">{t('hint')}</p>
      </div>
      {data && (
        <div className="grid gap-4 xl:grid-cols-2">
          {(Object.keys(data.values) as SettingsKey[]).map((k) => (
            <SettingsGroup
              key={k}
              name={k}
              value={data.values[k] as unknown as Record<string, Value>}
              defaults={data.defaults[k] as unknown as Record<string, Value>}
              onSaved={refresh}
            />
          ))}
        </div>
      )}
      <AdminSection title={t('fx')}>
        <p className="text-xs text-dim">{t('fxHint')}</p>
        <AdminTable
          rows={fx.data ?? []}
          rowKey={(r) => r.currency}
          columns={[
            {
              key: 'cur',
              title: 'currency',
              render: (r) => <span className="font-semibold">{r.currency}</span>,
            },
            {
              key: 'rate',
              title: t('usdRate'),
              render: (r) => (
                <FxRow
                  key={r.usdRate}
                  r={r}
                  onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'fx'] })}
                />
              ),
            },
            { key: 'src', title: 'source', className: 'text-xs text-dim', render: (r) => r.source },
            {
              key: 'upd',
              title: '',
              className: 'text-xs text-dim',
              render: (r) => fmtDate(r.updatedAt),
            },
          ]}
        />
      </AdminSection>
    </div>
  );
}
