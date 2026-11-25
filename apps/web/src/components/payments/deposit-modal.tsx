'use client';

import type {
  DepositDto,
  DepositQuoteDto,
  PaymentMethodDto,
  PromoActivateResultDto,
} from '@gunraid/shared';
import { FlaskConical, Info } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GemAmount, GemIcon } from '@/components/ui/gem';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { useMe } from '@/lib/me';
import { usePaymentMethods } from '@/lib/queries';
import { useUi } from '@/lib/store';

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'clip-cut h-9 px-3.5 text-xs font-bold uppercase tracking-wide transition [--cut:6px]',
            value === o.value
              ? 'bg-accent text-accent-ink'
              : 'bg-surface-3 text-muted hover:text-text',
          )}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Пополнение: курс «100 гемов = $1» всегда на виду; до оплаты показываем, сколько гемов будет начислено. */
export function DepositModal() {
  const t = useTranslations();
  const format = useFormatter();
  const open = useUi((s) => s.depositOpen);
  const presetPromo = useUi((s) => s.depositPromo);
  const close = useUi((s) => s.closeDeposit);
  const config = useConfig();
  const me = useMe();
  const router = useRouter();
  const errorText = useErrorMessage();
  const methods = usePaymentMethods(open && Boolean(me.data));
  const [method, setMethod] = useState<string>('card');
  const [currency, setCurrency] = useState<string>('USD');
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState<DepositQuoteDto | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [paying, setPaying] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [quoteNonce, setQuoteNonce] = useState(0);

  useEffect(() => {
    if (open && presetPromo) setPromo(presetPromo);
  }, [open, presetPromo]);

  const methodDto: PaymentMethodDto | undefined = useMemo(
    () => methods.data?.methods.find((m) => m.code === method),
    [methods.data, method],
  );
  const currencyDto = methodDto?.currencies.find((c) => c.code === currency);

  useEffect(() => {
    if (!methodDto) return;
    if (!methodDto.currencies.some((c) => c.code === currency)) {
      const first = methodDto.currencies[0];
      if (first) {
        setCurrency(first.code);
        setAmount(first.presets[1] ?? first.presets[0] ?? first.minAmount);
      }
    }
  }, [methodDto, currency]);

  useEffect(() => {
    if (!open || !me.data || !methodDto) return;
    const value = amount.replace(',', '.').trim();
    if (!/^\d{1,12}(\.\d{1,8})?$/.test(value) || Number(value) <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setLoadingQuote(true);
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      api
        .post<DepositQuoteDto>(
          '/deposits/quote',
          { method, currency, amount: value },
          { signal: ctrl.signal },
        )
        .then((q) => {
          setQuote(q);
          setQuoteError(null);
        })
        .catch((err: unknown) => {
          if ((err as Error).name === 'AbortError') return;
          setQuote(null);
          setQuoteError(
            err instanceof ApiError && err.code === 'DEPOSIT_AMOUNT_TOO_LOW' && currencyDto
              ? t('deposit.min', { amount: currencyDto.minAmount, currency })
              : errorText(err),
          );
        })
        .finally(() => setLoadingQuote(false));
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, me.data, method, currency, amount, methodDto, quoteNonce]);

  const pay = async () => {
    if (!quote) return;
    setPaying(true);
    try {
      const dep = await api.post<DepositDto>(
        '/deposits',
        { quoteId: quote.quoteId },
        { idempotencyKey: newIdempotencyKey() },
      );
      close();
      if (dep.paymentUrl?.startsWith('/')) router.push(dep.paymentUrl);
      else if (dep.paymentUrl) window.location.href = dep.paymentUrl;
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPaying(false);
    }
  };

  const rateLine = (
    <div className="flex items-center gap-2 font-display text-sm font-bold">
      <GemIcon size={16} /> {t('gems.rate', { gems: config.gemsPerUsd, usd: 1 })}
    </div>
  );

  const activatePromo = async () => {
    if (promo.trim().length < 3) return;
    setPromoBusy(true);
    try {
      const res = await api.post<PromoActivateResultDto>('/promo/activate', { code: promo.trim() });
      toast.success(
        res.type === 'balance'
          ? t('bonuses.promo.success.balance', {
              gems: t('gems.amount', { count: res.amount ?? 0 }),
            })
          : res.type === 'deposit_bonus'
            ? t('bonuses.promo.success.deposit_bonus', {
                percent: Math.round((res.percent ?? 0) * 100),
              })
            : res.type === 'free_case'
              ? t('bonuses.promo.success.free_case', { name: res.caseName ?? '' })
              : res.type === 'item'
                ? t('bonuses.promo.success.item', { name: res.item?.fullName ?? '' })
                : t('bonuses.promo.success.wheel_spin'),
      );
      setPromo('');
      setQuoteNonce((x) => x + 1);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPromoBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && close()}
      title={t('deposit.title')}
      description={rateLine}
      size="md"
    >
      {!methods.data ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {methodDto?.isTest && (
            <div className="cut flex gap-3 p-3 text-xs text-warning [--cut-bg:#262016] [--cut-border:rgb(255_178_30/0.35)]">
              <FlaskConical size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-wide">{t('deposit.test')}</div>
                <div className="text-muted">{t('deposit.testHint')}</div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">
              {t('deposit.method')}
            </div>
            <Segmented
              value={method}
              onChange={setMethod}
              options={methods.data.methods.map((m) => ({
                value: m.code,
                label: t.has(`deposit.methods.${m.code}`) ? t(`deposit.methods.${m.code}`) : m.code,
              }))}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">
              {t('deposit.currency')}
            </div>
            <Segmented
              value={currency}
              onChange={(c) => {
                setCurrency(c);
                const dto = methodDto?.currencies.find((x) => x.code === c);
                if (dto) setAmount(dto.presets[1] ?? dto.minAmount);
              }}
              options={(methodDto?.currencies ?? []).map((c) => ({ value: c.code, label: c.code }))}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="deposit-amount"
              className="text-xs font-semibold uppercase tracking-wider text-dim"
            >
              {t('deposit.amountIn', { currency })}
            </label>
            <Input
              id="deposit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-lg font-semibold"
            />
            <div className="flex flex-wrap gap-1.5">
              {currencyDto?.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="clip-cut h-8 bg-surface-3 px-3 text-xs font-semibold text-muted transition hover:text-text [--cut:5px]"
                  onClick={() => setAmount(p)}
                >
                  {format.number(Number(p))} {currency}
                </button>
              ))}
            </div>
          </div>

          <div className="cut space-y-2 p-4 [--cut-bg:var(--color-surface-2)]" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">{t('deposit.youGet')}</span>
              {loadingQuote ? (
                <span className="text-dim">{t('deposit.calculating')}</span>
              ) : quote ? (
                <GemAmount value={quote.gems} size="md" />
              ) : (
                <span className="text-dim">—</span>
              )}
            </div>
            {quote && quote.bonusGems > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('deposit.bonus')}</span>
                <GemAmount value={quote.bonusGems} signed size="md" className="text-accent" />
              </div>
            )}
            {quote && quote.entitlementBonusGems > 0 && (
              <div
                className="flex items-center justify-between text-sm"
                data-testid="deposit-ent-bonus"
              >
                <span className="text-muted">
                  {t('deposit.entitlementBonus', {
                    percent: Math.round((quote.entitlementPercent ?? 0) * 100),
                  })}
                </span>
                <GemAmount
                  value={quote.entitlementBonusGems}
                  signed
                  size="md"
                  className="text-accent"
                />
              </div>
            )}
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="font-display text-sm font-bold uppercase">{t('deposit.total')}</span>
              <GemAmount
                value={quote ? quote.gems + quote.bonusGems + quote.entitlementBonusGems : 0}
                size="lg"
                className="text-accent"
              />
            </div>
            {quoteError && <p className="text-xs text-danger">{quoteError}</p>}
            {quote && (
              <p className="text-[11px] text-dim">
                {t('deposit.quoteValid', {
                  time: format.dateTime(new Date(quote.expiresAt), { timeStyle: 'short' }),
                })}
              </p>
            )}
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void activatePromo();
            }}
          >
            <Input
              value={promo}
              onChange={(e) => setPromo(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32))}
              placeholder={t('deposit.promoPlaceholder')}
              aria-label={t('deposit.promo')}
              className="h-10 font-mono uppercase"
              data-testid="deposit-promo"
            />
            <Button
              type="submit"
              variant="secondary"
              loading={promoBusy}
              disabled={promo.length < 3}
            >
              {t('deposit.promoApply')}
            </Button>
          </form>

          <Button
            size="lg"
            block
            disabled={!quote || loadingQuote}
            loading={paying}
            onClick={() => void pay()}
            data-testid="deposit-pay"
          >
            {t('deposit.pay')}
          </Button>
          <p className="flex items-start gap-2 text-xs text-dim">
            <Info size={14} className="mt-0.5 shrink-0" />
            {t('deposit.noWithdraw')}
          </p>
        </div>
      )}
    </Modal>
  );
}
