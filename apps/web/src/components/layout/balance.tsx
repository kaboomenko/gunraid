'use client';

import { formatGems, formatGemsCompact } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { GemAmount, GemIcon } from '@/components/ui/gem';
import { Hint } from '@/components/ui/hint';
import { useConfig } from '@/lib/config';

/**
 * Баланс в хедере; курс «100 гемов = $1» — в подсказке по наведению или тапу. large — шапка десктопа,
 * phone — шапка телефона: плашка высотой 36 цвета страницы, скругление 6, поля 12, кристалл 8×12, через 6
 * сумма DemiBold 12 (от 100 000 — сокращённо: «1.23M»).
 */
export function BalancePill({
  balance,
  large,
  phone,
}: {
  balance: number;
  large?: boolean;
  phone?: boolean;
}) {
  const t = useTranslations('gems');
  const config = useConfig();
  // Телефон: видимая сумма входит в имя кнопки («Баланс: 12 345 гемов»), иначе aria-label скрывал бы её от
  // читалки; сокращённая (от 100 000) — вместе с полной: «Баланс: 12.35M (12 345 678 гемов)» — так кнопку
  // находит и голосовое управление по видимой подписи.
  const short = formatGemsCompact(balance);
  const phoneName =
    short === formatGems(balance)
      ? t('balanceValue', { count: balance })
      : t('balanceValueShort', { short, count: balance });
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
            : phone
              ? 'flex h-9 shrink-0 items-center rounded-[6px] bg-bg px-3 transition hover:brightness-125'
              : 'clip-cut flex h-10 items-center gap-2 bg-surface-2 px-2.5 transition hover:bg-surface-3 [--cut:7px] sm:px-3'
        }
        aria-label={phone ? phoneName : t('balance')}
        data-testid="balance"
      >
        {phone ? (
          <GemAmount value={balance} size="xs" compact className="gap-1.5" />
        ) : large && balance >= 1_000_000 ? (
          // До 1280px семизначный баланс не помещается в шапку рядом с меню (на 1024 правый блок выходил
          // на 8–24 px за поле плашки): там он сокращён — «1.23M», с 1280px — полностью.
          <>
            <GemAmount value={balance} size="xxl" compact className="xl:hidden" />
            <GemAmount value={balance} size="xxl" className="hidden xl:inline-flex" />
          </>
        ) : large ? (
          <GemAmount value={balance} size="xxl" />
        ) : (
          <GemAmount value={balance} size="sm" compact />
        )}
      </button>
    </Hint>
  );
}
