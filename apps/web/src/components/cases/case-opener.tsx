'use client';

import {
  WS_EVENTS,
  WS_ROOMS,
  type CaseDetailDto,
  type CaseOpenResultDto,
  type CaseSupplyPayload,
  type SellResultDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Lock, RotateCcw, ShieldCheck, Volume2, VolumeX, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ItemTile } from '@/components/items/item-tile';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { GemAmount } from '@/components/ui/gem';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { useInvalidateWallet } from '@/lib/queries';
import { useRoom, useSocketEvent } from '@/lib/socket';
import { sound } from '@/lib/sound';
import { usePrefs, useUi } from '@/lib/store';
import { Roulette } from './roulette';

function tierOf(price: number, casePrice: number): number {
  const base = Math.max(casePrice, 1);
  if (price >= base * 5) return 3;
  if (price >= base * 2) return 2;
  if (price >= base) return 1;
  return 0;
}

export function CaseOpener({ game, initial }: { game: string; initial: CaseDetailDto }) {
  const t = useTranslations();
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);
  const fast = usePrefs((s) => s.fast);
  const setFast = usePrefs((s) => s.setFast);
  const soundOn = usePrefs((s) => s.sound);
  const setSound = usePrefs((s) => s.setSound);

  const detail = useQuery({
    queryKey: ['case', game, initial.slug, me.data?.id ?? 'guest'],
    queryFn: () => api.get<CaseDetailDto>(`/games/${game}/cases/${initial.slug}`),
    initialData: me.data ? undefined : initial,
    enabled: !me.isLoading,
  });
  const c = detail.data ?? initial;
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaseOpenResultDto | null>(null);
  const [spinId, setSpinId] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [sold, setSold] = useState<Set<string>>(new Set());
  const [supply, setSupply] = useState<{ used: number; total: number } | null>(
    c.supplyTotal !== null ? { used: c.supplyUsed, total: c.supplyTotal } : null,
  );
  const finished = useRef(0);

  useRoom(c.supplyTotal !== null ? WS_ROOMS.case(c.id) : null);
  useSocketEvent<CaseSupplyPayload>(WS_EVENTS.caseSupply, (p) => {
    if (p.caseId === c.id) setSupply({ used: p.supplyUsed, total: p.supplyTotal });
  });

  const pool = useMemo(() => c.items, [c.items]);
  const winners = result?.results.map((r) => r.item) ?? [];
  const lanes = result ? result.results.length : count;

  const onLaneDone = useCallback(() => {
    finished.current += 1;
    if (result && finished.current >= result.results.length) {
      const best = Math.max(...result.results.map((r) => tierOf(r.item.price, c.price)));
      sound.win(best);
      setShowResult(true);
    }
  }, [result, c.price]);

  const open = async () => {
    if (!me.data) return openLogin();
    setBusy(true);
    try {
      const res = await api.post<CaseOpenResultDto>(
        `/games/${game}/cases/${c.slug}/open`,
        { count },
        { idempotencyKey: newIdempotencyKey() },
      );
      finished.current = 0;
      setSold(new Set());
      setShowResult(false);
      setResult(res);
      setSpinId((x) => x + 1);
      if (!fast) sound.open();
      if (res.supplyUsed !== null && res.supplyTotal !== null) setSupply({ used: res.supplyUsed, total: res.supplyTotal });
      invalidate();
      void qc.invalidateQueries({ queryKey: ['case', game, c.slug] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE') {
        toast.error(t('case.notEnough'));
        openDeposit();
      } else toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const sell = async (userItemIds: string[]) => {
    try {
      const res = await api.post<SellResultDto>(
        `/games/${game}/inventory/sell`,
        { userItemIds },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSold((prev) => new Set([...prev, ...res.soldIds]));
      toast.success(t('inventory.soldToast', { count: res.soldCount, gems: t('gems.amount', { count: res.total }) }));
      invalidate();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const a = c.availability;
  const blocked = me.data ? !a.canOpen && a.reason !== 'LOGIN' : false;
  const total = c.price * count;
  const spinning = Boolean(result) && !showResult && finished.current < (result?.results.length ?? 0);
  const unsoldIds = result?.results.filter((r) => !sold.has(r.userItemId)).map((r) => r.userItemId) ?? [];
  const resultValue = result?.results.filter((r) => !sold.has(r.userItemId)).reduce((s, r) => s + r.item.price, 0) ?? 0;

  let action: React.ReactNode;
  if (!me.data) {
    action = (
      <Button size="lg" onClick={openLogin} className="min-w-56">
        {t('case.loginToOpen')}
      </Button>
    );
  } else if (blocked) {
    const label =
      a.reason === 'LEVEL'
        ? t('case.levelRequired', { level: a.levelRequired ?? 0 })
        : a.reason === 'SOLD_OUT'
          ? t('case.soldOut')
          : a.reason === 'ADULT'
            ? t('case.adultRequired')
            : a.reason === 'COOLDOWN'
              ? t('case.cooldown')
              : t('case.unavailable');
    action = (
      <Button size="lg" disabled className="min-w-56">
        <Lock size={18} /> {label}
        {a.reason === 'COOLDOWN' && a.availableAt && (
          <Countdown to={a.availableAt} className="tabular" onDone={() => void detail.refetch()} />
        )}
      </Button>
    );
  } else {
    action = (
      <Button size="lg" loading={busy} disabled={spinning} onClick={() => void open()} className="min-w-56" data-testid="case-open">
        {c.kind === 'free' ? (
          t('case.openFree')
        ) : (
          <>
            {t('case.openFor')} <GemAmount value={total} size="md" />
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {Array.from({ length: lanes }, (_, i) => (
          <Roulette
            key={i}
            pool={pool}
            winner={winners[i] ?? null}
            spinId={spinId}
            fast={fast}
            compact={lanes > 1}
            durationMs={5600 + i * 250}
            onDone={onLaneDone}
          />
        ))}
      </div>

      {supply && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted">
            <span>{t('case.limited')}</span>
            <span className="tabular">{t('case.supply', { left: supply.total - supply.used, total: supply.total })}</span>
          </div>
          <Progress value={supply.total - supply.used} max={supply.total} />
        </div>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        {c.kind !== 'free' && (
          <div className="flex gap-1.5" role="group" aria-label={t('case.count')}>
            {Array.from({ length: c.maxOpenCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCount(n);
                  setResult(null);
                }}
                className={cn(
                  'clip-cut h-12 w-12 font-display text-sm font-bold transition [--cut:7px]',
                  count === n ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-muted hover:text-text',
                )}
                aria-pressed={count === n}
              >
                x{n}
              </button>
            ))}
          </div>
        )}
        {action}
        <div className="flex gap-1.5">
          <Button
            variant={fast ? 'outline' : 'secondary'}
            size="icon"
            className="h-12 w-12"
            onClick={() => setFast(!fast)}
            aria-pressed={fast}
            aria-label={t('case.fast')}
            title={t('case.fast')}
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
            title={t('case.sound')}
          >
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </Button>
        </div>
      </div>

      <Modal
        open={showResult && Boolean(result)}
        onOpenChange={(v) => !v && setShowResult(false)}
        title={t('case.resultTitle', { count: result?.results.length ?? 1 })}
        size={result && result.results.length > 2 ? 'lg' : 'md'}
      >
        {result && (
          <div className="space-y-5">
            <div className={cn('grid gap-2.5', result.results.length > 2 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2')}>
              {result.results.map((r) => (
                <ItemTile
                  key={r.userItemId}
                  item={r.item}
                  stLabel={t('items.stattrakBadge')}
                  svLabel={t('items.souvenirBadge')}
                  dimmed={sold.has(r.userItemId)}
                  footer={
                    sold.has(r.userItemId) ? (
                      <span className="mt-2 text-[11px] font-semibold uppercase text-dim">{t('case.sold')}</span>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase text-dim hover:text-accent"
                        onClick={() => void sell([r.userItemId])}
                      >
                        <Coins size={12} /> {t('case.sellOne')}
                      </button>
                    )
                  }
                />
              ))}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{t('case.total')}</span>
              <GemAmount value={resultValue} size="lg" className="text-accent" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button variant="secondary" disabled={!unsoldIds.length} onClick={() => void sell(unsoldIds)} data-testid="result-sell-all">
                {t('case.sellAll')} <GemAmount value={resultValue} size="sm" />
              </Button>
              <Button variant="secondary" onClick={() => setShowResult(false)}>
                {t('case.keep')}
              </Button>
              <Button
                onClick={() => {
                  setShowResult(false);
                  void open();
                }}
                disabled={blocked || c.kind === 'free'}
              >
                <RotateCcw size={16} /> {t('case.openAgain')}
              </Button>
            </div>
            <Link
              href={`/provably-fair?opening=${result.results[0]?.openingId ?? ''}`}
              className="flex items-center justify-center gap-2 text-xs text-dim hover:text-text"
            >
              <ShieldCheck size={14} /> {t('case.fair')}
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
