import { formatGems, formatGemsCompact } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** Иконка гема — гранёный кристалл #C6FF00. Ставится рядом с каждой суммой на сайте. */
export function GemIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <path d="M2 9 7 3l2.5 6Z" fill="#DFFF66" />
      <path d="M7 3h5L9.5 9Z" fill="#EBFF99" />
      <path d="M9.5 9 12 3l2.5 6Z" fill="#F5FFCC" />
      <path d="M12 3h5l-2.5 6Z" fill="#E1FF73" />
      <path d="m17 3 5 6h-7.5Z" fill="#C6FF00" />
      <path d="M2 9h7.5L12 21Z" fill="#B5EB00" />
      <path d="M9.5 9h5L12 21Z" fill="#C6FF00" />
      <path d="M14.5 9H22L12 21Z" fill="#8DBA00" />
    </svg>
  );
}

const SIZES = {
  xs: { text: 'text-xs', icon: 12, gap: 'gap-0.5' },
  sm: { text: 'text-sm', icon: 14, gap: 'gap-1' },
  md: { text: 'text-base', icon: 16, gap: 'gap-1' },
  lg: { text: 'text-xl', icon: 20, gap: 'gap-1.5' },
  xl: { text: 'text-3xl', icon: 28, gap: 'gap-2' },
} as const;

export interface GemAmountProps {
  value: number;
  size?: keyof typeof SIZES;
  compact?: boolean;
  /** Показывать знак «+» для положительных сумм. */
  signed?: boolean;
  className?: string;
}

/** Сумма в гемах: иконка + число с разделителями; для скринридеров — «12 345 гемов». */
export function GemAmount({ value, size = 'md', compact, signed, className }: GemAmountProps) {
  const t = useTranslations('gems');
  const s = SIZES[size];
  const text = compact ? formatGemsCompact(Math.abs(value)) : formatGems(Math.abs(value));
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  return (
    <span
      className={cn('inline-flex items-center font-semibold whitespace-nowrap tabular', s.text, s.gap, className)}
      aria-label={t('amount', { count: value })}
      role="text"
    >
      <GemIcon size={s.icon} />
      <span aria-hidden="true">
        {sign}
        {text}
      </span>
    </span>
  );
}
