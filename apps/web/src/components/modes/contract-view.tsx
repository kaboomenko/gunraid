'use client';

import { contractRange } from '@gunraid/game-core';
import type { ContractConfigDto, ContractHistoryDto, ContractResultDto, SellResultDto, UserItemDto } from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Layers, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useInventory, useInvalidateWallet } from '@/lib/queries';
import { sound } from '@/lib/sound';
import { usePrefs, useUi } from '@/lib/store';

export function ContractView({ game }: { game: string }) {
  const t = useTranslations();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const fast = usePrefs((s) => s.fast);
  const setFast = usePrefs((s) => s.setFast);
  const config = useQuery({ queryKey: ['contract-config', game], queryFn: () => api.get<ContractConfigDto>(`/games/${game}/contract/config`) });
  const inventory = useInventory(game, 'price_desc', Boolean(me.data));
  const invItems = useMemo(() => inventory.data?.pages.flatMap((p) => p.items) ?? [], [inventory.data]);
  const [selected, setSelected] = useState<UserItemDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [melting, setMelting] = useState(false);
  const [result, setResult] = useState<ContractResultDto | null>(null);
  const [sold, setSold] = useState(false);

  const cfg = config.data;
  const max = cfg?.maxItems ?? 10;
  const min = cfg?.minItems ?? 3;
  const invested = selected.reduce((s, i) => s + i.item.price, 0);
  const range = cfg && invested ? contractRange(invested, cfg) : { min: 0, max: 0 };

  const toggle = (ui: UserItemDto) =>
    setSelected((prev) =>
      prev.some((x) => x.id === ui.id) ? prev.filter((x) => x.id !== ui.id) : prev.length >= max ? prev : [...prev, ui],
    );

  const sign = async () => {
    if (!me.data) return openLogin();
    setBusy(true);
    try {
      const res = await api.post<ContractResultDto>(
        `/games/${game}/contract`,
        { userItemIds: selected.map((s) => s.id) },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSold(false);
      if (fast) {
        setSelected([]);
        setResult(res);
        sound.win(res.result.price > res.inputValue ? 2 : 0);
      } else {
        setMelting(true);
        sound.open();
        setTimeout(() => {
          setMelting(false);
          setSelected([]);
          setResult(res);
          sound.win(res.result.price > res.inputValue ? 2 : 0);
        }, 2200);
      }
      invalidate();
      void qc.invalidateQueries({ queryKey: ['contract-history', game] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const sellResult = async () => {
    if (!result) return;
    try {
      const res = await api.post<SellResultDto>(
        `/games/${game}/inventory/sell`,
        { userItemIds: [result.resultUserItemId] },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSold(true);
      toast.success(t('inventory.soldToast', { count: res.soldCount, gems: t('gems.amount', { count: res.total }) }));
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remaining = Math.max(0, min - selected.length);

  return (
    <div className="space-y-6">
      {cfg && (
        <p className="text-sm text-muted">
          {t('contract.lead', { min: cfg.minItems, max: cfg.maxItems, from: cfg.coefMin, to: cfg.coefMax })}
        </p>
      )}
      <Card cut="lg" className="stripes space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase">{t('contract.slots')}</h2>
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              <Trash2 size={14} /> {t('contract.clear')}
            </Button>
          )}
        </div>
        <div className="relative grid grid-cols-5 gap-2 sm:grid-cols-10">
          {Array.from({ length: max }, (_, i) => {
            const it = selected[i];
            return (
              <button
                key={i}
                type="button"
                disabled={!it || melting}
                onClick={() => it && toggle(it)}
                className={cn(
                  'clip-cut relative grid aspect-square place-items-center overflow-hidden bg-surface-2 transition-all duration-700 [--cut:6px]',
                  melting && it && 'scale-0 opacity-0',
                )}
                style={
                  it
                    ? {
                        background: `radial-gradient(80% 80% at 50% 100%, ${it.item.rarity.color}55, var(--color-surface-2) 70%)`,
                        transitionDelay: melting ? `${i * 90}ms` : undefined,
                      }
                    : undefined
                }
              >
                {it?.item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.item.imageUrl} alt="" className="h-3/5 w-4/5 object-contain" />
                ) : (
                  <span className="text-xs text-dim">{i + 1}</span>
                )}
              </button>
            );
          })}
          {melting && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-24 w-24 animate-ping bg-accent/60 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" />
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="clip-cut bg-surface-2 p-3 [--cut:6px]">
            <div className="text-[11px] uppercase tracking-wider text-dim">{t('contract.invested')}</div>
            <GemAmount value={invested} size="lg" />
          </div>
          <div className="clip-cut bg-surface-2 p-3 [--cut:6px] sm:col-span-2">
            <div className="text-[11px] uppercase tracking-wider text-dim">{t('contract.range')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <GemAmount value={range.min} size="lg" /> <span className="text-dim">—</span>
              <GemAmount value={range.max} size="lg" className="text-accent" />
            </div>
            {cfg && <div className="text-[11px] text-dim">{t('contract.winChance', { value: Math.round(cfg.winProbability * 100) })}</div>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            block
            loading={busy}
            disabled={melting || selected.length < min}
            onClick={() => void sign()}
            data-testid="contract-sign"
          >
            <FileSignature size={18} />
            {remaining > 0 ? t('contract.need', { count: remaining }) : t('contract.sign')}
          </Button>
          <Button variant={fast ? 'outline' : 'secondary'} size="icon" className="h-12 w-12" onClick={() => setFast(!fast)} aria-pressed={fast} aria-label={t('case.fast')}>
            <Zap size={18} />
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase">{t('contract.pick')}</h2>
          <span className="text-xs text-dim">{selected.length >= max ? t('contract.full', { max }) : `${selected.length}/${max}`}</span>
        </div>
        {!me.data ? (
          <EmptyState icon={<Layers size={32} />} action={<Button onClick={openLogin}>{t('header.login')}</Button>} />
        ) : invItems.length ? (
          <div data-testid="contract-inventory" className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {invItems.map((ui) => (
              <ItemTile
                key={ui.id}
                item={ui.item}
                size="sm"
                stLabel={t('items.stattrakBadge')}
                svLabel={t('items.souvenirBadge')}
                selected={selected.some((s) => s.id === ui.id)}
                onClick={() => toggle(ui)}
              />
            ))}
          </div>
        ) : (
          <EmptyState text={t('upgrade.noItems')} />
        )}
      </section>

      {me.data && <ContractHistory game={game} />}

      <Modal open={Boolean(result)} onOpenChange={(v) => !v && setResult(null)} title={t('contract.resultTitle')} size="sm">
        {result && (
          <div className="space-y-4">
            <div className="mx-auto max-w-[220px]">
              <ItemTile item={result.result} stLabel={t('items.stattrakBadge')} svLabel={t('items.souvenirBadge')} dimmed={sold} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{t('contract.multiplier', { value: result.multiplier.toFixed(2) })}</span>
              <GemAmount value={result.result.price} size="lg" className={result.result.price >= result.inputValue ? 'text-accent' : ''} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={sold} onClick={() => void sellResult()}>
                {t('contract.sell')}
              </Button>
              <Button onClick={() => setResult(null)}>{t('contract.again')}</Button>
            </div>
            <Link href={`/provably-fair?contract=${result.id}`} className="flex items-center justify-center gap-1.5 text-xs text-dim hover:text-text">
              <ShieldCheck size={14} /> {t('upgrade.fair')}
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ContractHistory({ game }: { game: string }) {
  const t = useTranslations();
  const history = useQuery({ queryKey: ['contract-history', game], queryFn: () => api.get<ContractHistoryDto[]>(`/games/${game}/contract/history`) });
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold uppercase">{t('contract.history')}</h2>
      {history.data?.length ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
          {history.data.map((h) => (
            <ItemTile
              key={h.id}
              item={h.result}
              size="sm"
              stLabel={t('items.stattrakBadge')}
              svLabel={t('items.souvenirBadge')}
              footer={
                <span className={cn('mt-1 text-[11px] font-bold', h.multiplier >= 1 ? 'text-accent' : 'text-muted')}>
                  ×{h.multiplier.toFixed(2)} · <GemAmount value={h.inputValue} size="xs" className="font-normal" />
                </span>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState text={t('contract.historyEmpty')} />
      )}
    </section>
  );
}
