'use client';

import { useTranslations } from 'next-intl';
import { GemAmount, GemIcon } from '@/components/ui/gem';
import { Hint } from '@/components/ui/hint';
import { useConfig } from '@/lib/config';

/** Баланс в хедере; курс «100 гемов = $1» — в подсказке по наведению или тапу. */
export function BalancePill({ balance }: { balance: number }) {
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
          <p className="mt-2 text-xs leading-relaxed text-muted">{t('rateHint')}</p>
        </div>
      }
    >
      <button
        type="button"
        className="clip-cut flex h-10 items-center gap-2 bg-surface-2 px-3 transition hover:bg-surface-3 [--cut:7px]"
        aria-label={t('balance')}
        data-testid="balance"
      >
        <GemAmount value={balance} size="sm" compact />
      </button>
    </Hint>
  );
}
