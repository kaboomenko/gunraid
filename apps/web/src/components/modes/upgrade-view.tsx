'use client';

import { upgradeChance } from '@gunraid/game-core';
import type {
  ItemDto,
  ItemsPageDto,
  UpgradeConfigDto,
  UpgradeHistoryDto,
  UpgradeResultDto,
} from '@gunraid/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck, Target, Volume2, VolumeX, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useInventory, useInvalidateWallet } from '@/lib/queries';
import { sound } from '@/lib/sound';
import { usePrefs, useUi } from '@/lib/store';
import { UpgradeSpinner } from './upgrade-spinner';

const MAX_STAKE_ITEMS = 10;

export function UpgradeView({ game }: { game: string }) {
  const t = useTranslations();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const fast = usePrefs((s) => s.fast);
  const setFast = usePrefs((s) => s.setFast);
  const soundOn = usePrefs((s) => s.sound);
  const setSound = usePrefs((s) => s.setSound);

  const config = useQuery({
    queryKey: ['upgrade-config', game],
    queryFn: () => api.get<UpgradeConfigDto>(`/games/${game}/upgrade/config`),
  });
  const inventory = useInventory(game, 'price_desc', Boolean(me.data));
  const invItems = useMemo(
    () => inventory.data?.pages.flatMap((p) => p.items) ?? [],
    [inventory.data],
  );

  const [mode, setMode] = useState<'items' | 'gems'>('items');
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState('100');
  const [target, setTarget] = useState<ItemDto | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpgradeResultDto | null>(null);
  const [spinId, setSpinId] = useState(0);
  const [settled, setSettled] = useState(true);

  const stake =
    mode === 'items'
      ? invItems.filter((i) => selected.includes(i.id)).reduce((s, i) => s + i.item.price, 0)
      : Math.max(0, Math.floor(Number(amount) || 0));

  const targets = useInfiniteQuery({
    queryKey: ['upgrade-targets', game, stake, q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<ItemsPageDto>(
        `/games/${game}/upgrade/targets?minPrice=${stake + 1}&sort=price_asc&pageSize=24&page=${pageParam}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const targetList = targets.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    if (target && target.price <= stake) setTarget(null);
  }, [stake, target]);

  const chance =
    config.data && target && stake > 0 ? upgradeChance(stake, target.price, config.data) : 0;
  const tooLow = Boolean(config.data && target && stake > 0 && chance < config.data.minChance);

  const pickByMultiplier = async (mult: number) => {
    if (!stake) return toast.info(t('upgrade.needStake'));
    try {
      const page = await api.get<ItemsPageDto>(
        `/games/${game}/upgrade/targets?minPrice=${Math.round(stake * mult)}&sort=price_asc&pageSize=1`,
      );
      if (page.items[0]) setTarget(page.items[0]);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const go = async () => {
    if (!me.data) return openLogin();
    if (!target) return;
    setBusy(true);
    try {
      const body =
        mode === 'items'
          ? { userItemIds: selected, targetItemId: target.id }
          : { amount: stake, targetItemId: target.id };
      const res = await api.post<UpgradeResultDto>(`/games/${game}/upgrade`, body, {
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(res);
      setSettled(false);
      setSpinId((x) => x + 1);
      if (!fast) sound.open();
      if (mode === 'items') setSelected([]);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onSpinDone = () => {
    setSettled(true);
    if (result?.isWin) sound.win(2);
    else sound.lose();
    invalidate();
    void qc.invalidateQueries({ queryKey: ['upgrade-history', game] });
  };

  const shownChance = result && !settled ? result.chance / 1_000_000 : chance;
  const spinnerResult = result && settled ? (result.isWin ? 'win' : 'lose') : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px_1fr] lg:items-start">
        {/* Ставка */}
        <Card className="order-2 space-y-3 p-4 lg:order-1">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold uppercase">{t('upgrade.stake')}</h2>
            <GemAmount value={stake} className="text-accent" />
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'items' | 'gems')}>
            <TabsList>
              <TabsTrigger value="items">{t('upgrade.stakeItems')}</TabsTrigger>
              <TabsTrigger value="gems">{t('upgrade.stakeGems')}</TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="pt-3">
              {!me.data ? (
                <Button block onClick={openLogin}>
                  {t('header.login')}
                </Button>
              ) : invItems.length ? (
                <>
                  <p className="mb-2 text-xs text-dim">
                    {t('upgrade.selectItems')} · {t('upgrade.selected', { count: selected.length })}
                  </p>
                  <div
                    data-testid="upgrade-stake-items"
                    className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-3"
                  >
                    {invItems.map((ui) => (
                      <ItemTile
                        key={ui.id}
                        item={ui.item}
                        size="sm"
                        stLabel={t('items.stattrakBadge')}
                        svLabel={t('items.souvenirBadge')}
                        selected={selected.includes(ui.id)}
                        onClick={() => {
                          setResult(null);
                          setSelected((prev) =>
                            prev.includes(ui.id)
                              ? prev.filter((x) => x !== ui.id)
                              : prev.length >= MAX_STAKE_ITEMS
                                ? prev
                                : [...prev, ui.id],
                          );
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState text={t('upgrade.noItems')} />
              )}
            </TabsContent>
            <TabsContent value="gems" className="space-y-3 pt-3">
              <label
                htmlFor="upgrade-amount"
                className="text-xs font-semibold uppercase tracking-wider text-dim"
              >
                {t('upgrade.amount')}
              </label>
              <Input
                id="upgrade-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                className="h-12 text-lg font-semibold"
              />
              <div className="flex flex-wrap gap-1.5">
                {[50, 100, 500, 1000, 5000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="clip-cut h-8 bg-surface-3 px-3 text-xs font-semibold text-muted hover:text-text [--cut:5px]"
                    onClick={() => setAmount(String(v))}
                  >
                    <GemAmount value={v} size="xs" />
                  </button>
                ))}
                {me.data && (
                  <button
                    type="button"
                    className="clip-cut h-8 bg-surface-3 px-3 text-xs font-semibold text-muted hover:text-text [--cut:5px]"
                    onClick={() => setAmount(String(me.data?.balance ?? 0))}
                  >
                    {t('upgrade.allBalance')}
                  </button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </Card>

        {/* Спиннер */}
        <div className="order-1 space-y-4 lg:order-2">
          <UpgradeSpinner
            chance={shownChance}
            roll={result ? result.roll / 1_000_000 : null}
            spinId={spinId}
            fast={fast}
            result={spinnerResult}
            onDone={onSpinDone}
          >
            <div>
              {spinnerResult ? (
                <>
                  <div className="font-display text-2xl font-extrabold uppercase">
                    {spinnerResult === 'win' ? t('upgrade.win') : t('upgrade.lose')}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {spinnerResult === 'win' ? t('upgrade.winText') : t('upgrade.loseText')}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-display text-4xl font-extrabold tabular">
                    {(shownChance * 100).toFixed(2)}%
                  </div>
                  <div className="text-xs uppercase tracking-wider text-dim">
                    {t('upgrade.chance')}
                  </div>
                </>
              )}
            </div>
          </UpgradeSpinner>
          {tooLow && config.data && (
            <p className="text-center text-xs text-danger">
              {t('upgrade.tooLow', { min: config.data.minChance * 100 })}
            </p>
          )}
          <div className="flex gap-1.5">
            <Button
              size="lg"
              block
              loading={busy}
              disabled={
                !settled ||
                !target ||
                stake <= 0 ||
                tooLow ||
                (mode === 'gems' && Boolean(me.data) && stake > (me.data?.balance ?? 0))
              }
              onClick={() => void go()}
              data-testid="upgrade-go"
            >
              {t('upgrade.go')} <ArrowRight size={18} />
            </Button>
            <Button
              variant={fast ? 'outline' : 'secondary'}
              size="icon"
              className="h-12 w-12"
              onClick={() => setFast(!fast)}
              aria-pressed={fast}
              aria-label={t('case.fast')}
            >
              <Zap size={18} />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12"
              onClick={() => setSound(!soundOn)}
              aria-pressed={soundOn}
              aria-label={t('case.sound')}
            >
              {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </Button>
          </div>
          {config.data && (
            <p className="text-center text-[11px] text-dim">
              {t('upgrade.commission', {
                value: Math.round(config.data.commission * 100),
                max: Math.round(config.data.maxChance * 100),
              })}
            </p>
          )}
          {result && settled && (
            <Link
              href={`/provably-fair?upgrade=${result.id}`}
              className="flex items-center justify-center gap-1.5 text-xs text-dim hover:text-text"
            >
              <ShieldCheck size={14} /> {t('upgrade.fair')}
            </Link>
          )}
        </div>

        {/* Цель */}
        <Card className="order-3 space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold uppercase">{t('upgrade.target')}</h2>
            {target && <GemAmount value={target.price} className="text-accent" />}
          </div>
          {target ? (
            <div className="mx-auto max-w-[200px]">
              <ItemTile
                item={target}
                stLabel={t('items.stattrakBadge')}
                svLabel={t('items.souvenirBadge')}
              />
            </div>
          ) : (
            <div className="cut grid h-32 place-items-center text-center text-xs text-dim [--cut-bg:var(--color-surface-2)]">
              <div className="space-y-1">
                <Target className="mx-auto" />
                {t('upgrade.chooseTarget')}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
              {t('upgrade.multipliers')}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(config.data?.multipliers ?? [1.5, 2, 5, 10]).map((mul) => (
                <button
                  key={mul}
                  type="button"
                  className="clip-cut h-9 bg-surface-3 text-sm font-bold text-muted transition hover:bg-accent hover:text-accent-ink [--cut:6px]"
                  onClick={() => void pickByMultiplier(mul)}
                >
                  x{mul}
                </button>
              ))}
            </div>
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('upgrade.searchTarget')}
            aria-label={t('upgrade.searchTarget')}
            className="h-9"
          />
          <div
            data-testid="upgrade-targets"
            className="grid max-h-[300px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-3"
          >
            {targetList.map((it) => (
              <ItemTile
                key={it.id}
                item={it}
                size="sm"
                stLabel={t('items.stattrakBadge')}
                svLabel={t('items.souvenirBadge')}
                selected={target?.id === it.id}
                onClick={() => {
                  setResult(null);
                  setTarget(it);
                }}
              />
            ))}
          </div>
          {targets.hasNextPage && (
            <Button
              size="sm"
              variant="ghost"
              block
              loading={targets.isFetchingNextPage}
              onClick={() => void targets.fetchNextPage()}
            >
              {t('upgrade.loadMore')}
            </Button>
          )}
        </Card>
      </div>
      {me.data && <UpgradeHistory game={game} />}
    </div>
  );
}

function UpgradeHistory({ game }: { game: string }) {
  const t = useTranslations();
  const history = useQuery({
    queryKey: ['upgrade-history', game],
    queryFn: () => api.get<UpgradeHistoryDto[]>(`/games/${game}/upgrade/history`),
  });
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold uppercase">{t('upgrade.history')}</h2>
      {history.data?.length ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
          {history.data.map((h) => (
            <ItemTile
              key={h.id}
              item={h.target}
              size="sm"
              dimmed={!h.isWin}
              stLabel={t('items.stattrakBadge')}
              svLabel={t('items.souvenirBadge')}
              footer={
                <span
                  className={cn(
                    'mt-1 text-[11px] font-bold uppercase',
                    h.isWin ? 'text-accent' : 'text-danger',
                  )}
                >
                  {h.isWin ? t('upgrade.win') : t('upgrade.lose')} ·{' '}
                  {(h.chance / 10_000).toFixed(2)}%
                </span>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState text={t('upgrade.historyEmpty')} />
      )}
    </section>
  );
}
