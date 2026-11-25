'use client';

import { useTranslations } from 'next-intl';
import { GemAmount, GemIcon } from '@/components/ui/gem';
import { Hint } from '@/components/ui/hint';
import { useConfig } from '@/lib/config';

/** Баланс в хедере; курс «100 гемов = $1» — в подсказке по наведению или тапу. */
export function BalancePill({ balance, large }: { balance: number; large?: boolean }) {
  const t = useTranslations('gems');
  const config = useConfig();
  return (
    <Hint
      content={
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-dim">
            {t('rateTitle')}
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-display text-base font-bold">
            <GemIcon size={18} />
            {t('rate', { gems: config.gemsPerUsd, usd: 1 })}
          </div>
          <p className="mt-2 text-xs text-muted">{t('rateHint')}</p>
        </div>
      }
    >
      <button
        type="button"
        className={
          large
            ? 'flex h-[72px] items-center rounded-[12px] bg-bg px-6 transition hover:brightness-125'
            : 'clip-cut flex h-10 items-center gap-2 bg-surface-2 px-2.5 transition hover:bg-surface-3 [--cut:7px] sm:px-3'
        }
        aria-label={t('balance')}
        data-testid="balance"
      >
        {large ? (
          <GemAmount value={balance} size="xxl" />
        ) : (
          <GemAmount value={balance} size="sm" compact />
        )}
      </button>
    </Hint>
  );
}
