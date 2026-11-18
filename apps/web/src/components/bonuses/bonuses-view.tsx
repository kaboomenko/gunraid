'use client';

import type {
  DailyClaimResultDto,
  DailyStateDto,
  EntitlementDto,
  LevelInfoDto,
  LevelRewardDto,
  PromoActivateResultDto,
  ReferralInfoDto,
  WheelPrizeDto,
  WheelSpinResultDto,
  WheelStateDto,
} from '@gunraid/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck,
  Check,
  Copy,
  Gift,
  Package,
  RotateCw,
  ShieldCheck,
  Star,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { EmptyState } from '@/components/ui/empty-state';
import { GemAmount, GemPill } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';
import { api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { bonusKeys, useInvalidateBonuses, useInvalidateWallet } from '@/lib/queries';
import { sound } from '@/lib/sound';
import { useUi } from '@/lib/store';
import { FortuneWheel } from './fortune-wheel';

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-base font-bold uppercase">
      <span className="text-accent">{icon}</span>
      {children}
    </h2>
  );
}

/** Текст приза колеса (для результата и истории). */
export function PrizeLabel({ prize }: { prize: WheelPrizeDto }) {
  const t = useTranslations('bonuses');
  switch (prize.type) {
    case 'balance':
      return <GemAmount value={prize.amount ?? 0} className="text-accent" />;
    case 'item':
      return <span className="font-semibold">{prize.item?.fullName ?? prize.label}</span>;
    case 'free_case':
      return <span className="font-semibold">{prize.label}</span>;
    case 'deposit_bonus':
      return (
        <span className="font-semibold">
          {t('mine.deposit_bonus', {
            percent: Math.round((prize.percent ?? 0) * 100),
            max: prize.maxAmount ?? 0,
          })}
        </span>
      );
    default:
      return <span className="font-semibold">{t('wheel.prizeTypes.extra_spin')}</span>;
  }
}

// ---------- Колесо ----------

function WheelCard({ game, initial }: { game: string; initial: WheelStateDto }) {
  const t = useTranslations('bonuses.wheel');
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateBonuses();
  const invalidateWallet = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);
  const state = useQuery({
    queryKey: bonusKeys.wheel(game),
    queryFn: () => api.get<WheelStateDto>(`/games/${game}/wheel`),
    placeholderData: initial,
    staleTime: 0,
  });
  const [target, setTarget] = useState<{ index: number; spinId: string } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpinResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const s = state.data ?? initial;

  const spin = async () => {
    if (!me.data) return openLogin();
    setBusy(true);
    try {
      const res = await api.post<WheelSpinResultDto>(`/games/${game}/wheel/spin`, undefined, {
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(null);
      setSpinning(true);
      setTarget({ index: res.prizeIndex, spinId: res.id });
      sound.open();
      qc.setQueryData<WheelStateDto>(bonusKeys.wheel(game), (old) =>
        old ? { ...old, canSpin: false, nextAt: res.nextAt, extraSpins: res.extraSpins } : old,
      );
      setTimeout(() => setResult(res), 0);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onDone = () => {
    setSpinning(false);
    sound.win(2);
    invalidate();
    invalidateWallet();
  };

  const reasonText =
    s.reason === 'ACCOUNT_AGE'
      ? t('reasons.ACCOUNT_AGE', { hours: s.minAccountAgeHours })
      : s.reason === 'NO_DEPOSIT'
        ? t('reasons.NO_DEPOSIT', { days: s.requireDepositWithinDays ?? 0 })
        : s.reason
          ? t(`reasons.${s.reason}`)
          : null;

  return (
    <Card cut="lg" className="stripes space-y-5 p-4 sm:p-6" id="wheel">
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<RotateCw size={18} />}>{t('title')}</CardTitle>
        {s.extraSpins > 0 && (
          <span className="clip-cut bg-accent-soft px-2 py-1 text-xs font-bold text-accent [--cut:5px]">
            {t('extra', { count: s.extraSpins })}
          </span>
        )}
      </div>
      <FortuneWheel prizes={s.prizes} target={target} onDone={onDone} />
      <div className="space-y-2 text-center">
        {result && !spinning && (
          <div
            className="cut mx-auto flex max-w-sm flex-col items-center gap-1 p-3 [--cut-border:rgb(198_255_0/0.7)] [--cut-bg:#1b2110]"
            data-testid="wheel-result"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-dim">
              {t('won')}
            </span>
            <PrizeLabel prize={result.prize} />
            <Link
              href={`/provably-fair?wheel=${result.id}`}
              className="flex items-center gap-1 text-[11px] text-dim hover:text-text"
            >
              <ShieldCheck size={12} /> {t('fair')}
            </Link>
          </div>
        )}
        <Button
          size="lg"
          className="min-w-56"
          loading={busy}
          disabled={spinning || (Boolean(me.data) && !s.canSpin)}
          onClick={() => void spin()}
          data-testid="wheel-spin"
        >
          <RotateCw size={18} />
          {s.reason === 'COOLDOWN' || !s.nextAt || s.extraSpins === 0 ? t('spin') : t('spinExtra')}
        </Button>
        {s.nextAt && (
          <p className="text-xs text-muted">
            {t('next')} <Countdown to={s.nextAt} className="font-semibold text-text tabular" />
          </p>
        )}
        {reasonText && s.reason !== 'COOLDOWN' && (
          <p className="text-xs text-warning">
            {reasonText}{' '}
            {s.reason === 'NO_DEPOSIT' && (
              <button
                type="button"
                className="font-semibold text-accent underline"
                onClick={openDeposit}
              >
                {t('deposit')}
              </button>
            )}
          </p>
        )}
        <p className="text-[11px] text-dim">{t('cooldownHint', { hours: s.cooldownHours })}</p>
      </div>
      {me.data && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-dim">
            {t('history')}
          </div>
          {s.history.length ? (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {s.history.slice(0, 6).map((h) => (
                <li
                  key={h.id}
                  className="clip-cut flex items-center justify-between gap-2 bg-surface-2 px-3 py-2 text-sm [--cut:5px]"
                >
                  <PrizeLabel prize={h.prize} />
                  <span className="text-[11px] text-dim">
                    {new Date(h.createdAt).toLocaleDateString('ru-RU')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-dim">{t('historyEmpty')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Ежедневный бонус ----------

function DailyCard() {
  const t = useTranslations('bonuses.daily');
  const tg = useTranslations('gems');
  const me = useMe();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const invalidateWallet = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const [busy, setBusy] = useState(false);
  const daily = useQuery({
    queryKey: bonusKeys.daily,
    enabled: Boolean(me.data),
    queryFn: () => api.get<DailyStateDto>('/bonuses/daily'),
  });
  const d = daily.data;
  const claim = async () => {
    if (!me.data) return openLogin();
    setBusy(true);
    try {
      const res = await api.post<DailyClaimResultDto>('/bonuses/daily/claim', undefined, {
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t('claimedToast', { gems: tg('amount', { count: res.amount }) }));
      sound.win(1);
      invalidateWallet();
      await qc.invalidateQueries({ queryKey: bonusKeys.daily });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const rewards = d?.rewards ?? [5, 10, 15, 20, 25, 30, 50];
  // Позиция текущего дня в недельной ленте.
  const dayPos = d ? ((d.streak - 1) % rewards.length) + 1 : 1;
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <CardTitle icon={<CalendarCheck size={18} />}>{t('title')}</CardTitle>
        <p className="mt-1 text-xs text-muted">{t('lead')}</p>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {rewards.map((r, i) => {
          const n = i + 1;
          const done = d ? (d.claimedToday ? n <= dayPos : n < dayPos) : false;
          const current = d ? n === dayPos && !d.claimedToday : false;
          return (
            <div
              key={n}
              className={cn(
                'clip-cut flex flex-col items-center gap-1 px-1 py-2 text-center [--cut:5px]',
                done
                  ? 'bg-accent text-accent-ink'
                  : current
                    ? 'bg-accent-soft text-accent ring-1 ring-inset ring-accent'
                    : 'bg-surface-2 text-muted',
              )}
            >
              <span className="text-[10px] font-bold uppercase">{t('day', { n })}</span>
              {done ? <Check size={14} strokeWidth={3} /> : <GemAmount value={r} size="xs" />}
            </div>
          );
        })}
      </div>
      {d && (
        <p className="text-xs text-dim">
          {t('streak', { count: d.claimedToday ? d.streak : Math.max(0, d.streak - 1) })}
        </p>
      )}
      {d?.blocked === 'NO_DEPOSIT' && (
        <p className="text-xs text-warning">
          {t('noDeposit', { days: d.requireDepositWithinDays ?? 0 })}
        </p>
      )}
      {d?.claimedToday ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-accent">
            <Check size={16} /> {t('claimed')}
          </span>
          <span className="text-xs text-muted">
            {t('next')} <Countdown to={d.nextAt} className="font-semibold text-text tabular" />
          </span>
        </div>
      ) : (
        <Button
          block
          loading={busy}
          disabled={Boolean(me.data) && !d?.canClaim}
          onClick={() => void claim()}
          data-testid="daily-claim"
        >
          <Gift size={16} /> {t('claim')} {d && <GemPill value={d.todayReward} />}
        </Button>
      )}
    </Card>
  );
}

// ---------- Промокод ----------

function PromoCard({ game }: { game: string }) {
  const t = useTranslations('bonuses.promo');
  const tg = useTranslations('gems');
  const me = useMe();
  const errorText = useErrorMessage();
  const invalidate = useInvalidateBonuses();
  const invalidateWallet = useInvalidateWallet();
  const openLogin = useUi((s) => s.openLogin);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    if (!me.data) return openLogin();
    if (code.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await api.post<PromoActivateResultDto>('/promo/activate', {
        code: code.trim(),
        game,
      });
      const text =
        res.type === 'balance'
          ? t('success.balance', { gems: tg('amount', { count: res.amount ?? 0 }) })
          : res.type === 'deposit_bonus'
            ? t('success.deposit_bonus', { percent: Math.round((res.percent ?? 0) * 100) })
            : res.type === 'free_case'
              ? t('success.free_case', { name: res.caseName ?? '' })
              : res.type === 'item'
                ? t('success.item', { name: res.item?.fullName ?? '' })
                : t('success.wheel_spin');
      toast.success(text);
      sound.win(1);
      setCode('');
      invalidate();
      invalidateWallet();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div>
        <CardTitle icon={<Ticket size={18} />}>{t('title')}</CardTitle>
        <p className="mt-1 text-xs text-muted">{t('lead')}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void activate();
        }}
      >
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32))}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="h-11 font-mono uppercase"
          data-testid="promo-input"
        />
        <Button
          type="submit"
          loading={busy}
          disabled={code.trim().length < 3}
          data-testid="promo-activate"
        >
          {t('activate')}
        </Button>
      </form>
    </Card>
  );
}

// ---------- Мои бонусы ----------

export function EntitlementsCard() {
  const t = useTranslations('bonuses.mine');
  const me = useMe();
  const openDeposit = useUi((s) => s.openDeposit);
  const list = useQuery({
    queryKey: bonusKeys.entitlements,
    enabled: Boolean(me.data),
    queryFn: () => api.get<EntitlementDto[]>('/me/entitlements'),
  });
  if (!me.data) return null;
  const items = list.data ?? [];
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="entitlements">
      <CardTitle icon={<Package size={18} />}>{t('title')}</CardTitle>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((e) => (
            <li
              key={e.id}
              className="clip-cut flex items-center gap-3 bg-surface-2 px-3 py-2 text-sm [--cut:6px]"
            >
              {e.case?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.case.imageUrl} alt="" className="h-8 w-8 object-contain" />
              ) : e.type === 'wheel_spin' ? (
                <RotateCw size={18} className="text-accent" />
              ) : (
                <Wallet size={18} className="text-info" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {e.type === 'free_case'
                    ? t('free_case', { name: e.case?.name ?? '' })
                    : e.type === 'wheel_spin'
                      ? t('wheel_spin')
                      : t('deposit_bonus', {
                          percent: Math.round((e.percent ?? 0) * 100),
                          max: e.maxAmount ?? 0,
                        })}
                </div>
                <div className="text-[11px] text-dim">{t(`sources.${e.source}`)}</div>
              </div>
              {e.type === 'free_case' && e.case ? (
                <Button size="sm" asChild>
                  <Link href={`/${e.case.game}/case/${e.case.slug}`}>{t('open')}</Link>
                </Button>
              ) : e.type === 'wheel_spin' ? (
                <Button size="sm" variant="secondary" asChild>
                  <a href="#wheel">{t('spin')}</a>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={openDeposit}>
                  {t('deposit')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-dim">{t('empty')}</p>
      )}
    </Card>
  );
}

// ---------- Уровень ----------

function RewardText({ reward }: { reward: LevelRewardDto }) {
  const t = useTranslations('bonuses.level');
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {reward.balance ? (
        <GemAmount value={reward.balance} size="sm" className="text-accent" />
      ) : null}
      {reward.wheelSpins ? <span>{t('rewardSpins', { count: reward.wheelSpins })}</span> : null}
      {reward.depositBonus ? (
        <span>
          {t('rewardDeposit', { percent: Math.round(reward.depositBonus.percent * 100) })}
        </span>
      ) : null}
    </span>
  );
}

export function LevelCard() {
  const t = useTranslations('bonuses.level');
  const me = useMe();
  const level = useQuery({
    queryKey: bonusKeys.level,
    enabled: Boolean(me.data),
    queryFn: () => api.get<LevelInfoDto>('/me/level'),
  });
  const l = level.data;
  if (!me.data || !l) return null;
  const span = l.nextLevelXp !== null ? l.nextLevelXp - l.currentLevelXp : 1;
  const done = l.nextLevelXp !== null ? l.xp - l.currentLevelXp : 1;
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="level-card">
      <div className="flex items-center justify-between">
        <CardTitle icon={<Star size={18} />}>{t('level', { level: l.level })}</CardTitle>
        <span className="text-xs text-muted tabular">
          {t('xp', { xp: l.xp.toLocaleString('ru-RU') })}
        </span>
      </div>
      <Progress value={Math.max(0, Math.min(100, (done / span) * 100))} />
      {l.nextLevelXp !== null ? (
        <p className="text-xs text-muted">
          {t('toNext', {
            level: l.level + 1,
            xp: Math.max(0, l.nextLevelXp - l.xp).toLocaleString('ru-RU'),
          })}
        </p>
      ) : (
        <p className="text-xs text-accent">{t('max')}</p>
      )}
      {l.nextReward && (
        <div className="clip-cut bg-surface-2 p-3 text-xs [--cut:6px]">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-dim">
            {t('nextReward')}
          </div>
          <RewardText reward={l.nextReward} />
        </div>
      )}
      <p className="text-[11px] text-dim">{t('hint', { xp: l.xpPerGem })}</p>
    </Card>
  );
}

// ---------- Рефералы ----------

export function ReferralCard() {
  const t = useTranslations('bonuses.referral');
  const tc = useTranslations('common');
  const me = useMe();
  const [copied, setCopied] = useState(false);
  const info = useQuery({
    queryKey: bonusKeys.referrals,
    enabled: Boolean(me.data),
    queryFn: () => api.get<ReferralInfoDto>('/me/referrals'),
  });
  const r = info.data;
  if (!me.data || !r) return null;
  const link =
    typeof window !== 'undefined' ? `${window.location.origin}/r/${r.code}` : `/r/${r.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер недоступен
    }
  };
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="referral-card">
      <div>
        <CardTitle icon={<Users size={18} />}>{t('title')}</CardTitle>
        <p className="mt-1 text-xs text-muted">
          {t('lead', { percent: Math.round(r.percent * 100) })}
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={link}
          aria-label={t('link')}
          className="h-10 font-mono text-xs"
          suppressHydrationWarning
        />
        <Button variant="secondary" onClick={() => void copy()} aria-label={tc('copy')}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="clip-cut bg-surface-2 p-2 [--cut:6px]">
          <div className="text-[10px] uppercase tracking-wider text-dim">{t('invited')}</div>
          <div className="font-display text-lg font-bold">{r.invited}</div>
        </div>
        <div className="clip-cut bg-surface-2 p-2 [--cut:6px]">
          <div className="text-[10px] uppercase tracking-wider text-dim">{t('depositors')}</div>
          <div className="font-display text-lg font-bold">{r.depositors}</div>
        </div>
        <div className="clip-cut bg-surface-2 p-2 [--cut:6px]">
          <div className="text-[10px] uppercase tracking-wider text-dim">{t('earned')}</div>
          <GemAmount value={r.earned} className="justify-center text-accent" />
        </div>
      </div>
      {r.recent.length > 0 && (
        <ul className="space-y-1 text-xs">
          {r.recent.map((x, i) => (
            <li key={i} className="flex justify-between gap-2 text-muted">
              <span className="truncate">{x.nickname}</span>
              <GemAmount value={x.amount} size="xs" signed className="text-accent" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function BonusesView({ game, initialWheel }: { game: string; initialWheel: WheelStateDto }) {
  const t = useTranslations('bonuses');
  const me = useMe();
  const openLogin = useUi((s) => s.openLogin);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
      <WheelCard game={game} initial={initialWheel} />
      <div className="space-y-5">
        <DailyCard />
        <PromoCard game={game} />
        {me.data ? (
          <>
            <EntitlementsCard />
            <LevelCard />
            <ReferralCard />
          </>
        ) : (
          <EmptyState
            icon={<Gift size={32} />}
            text={t('lead')}
            action={<Button onClick={openLogin}>{t('title')}</Button>}
          />
        )}
      </div>
    </div>
  );
}
