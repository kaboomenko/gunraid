import { formatGems, formatGemsCompact } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** Иконка гема — кристалл из макета (16×24), цвет #C6FF00. size — высота; ставится рядом с каждой суммой. */
export function GemIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={Math.round(((size * 2) / 3) * 100) / 100}
      height={size}
      viewBox="0 0 16 24"
      aria-hidden="true"
      focusable="false"
      fill="#C6FF00"
      className={cn('shrink-0', className)}
    >
      <path d="M8.00001 2.49812L4.74131 12.0006H0.693017L8.00001 2.49812Z" />
      <path d="M15.7329 12.0006H11.2586L8.00001 2.49812L15.7329 12.0006Z" />
      <path d="M11.2586 12.0006L8.00001 23.7637L4.74131 12.0006H11.2586Z" />
      <path d="M8.00001 2.49812L13.991 12L8.00001 21.5025L2.00903 12L8.00001 2.49812ZM9.04705 0.588608C8.55185 -0.196203 7.44816 -0.196203 6.95296 0.588608L0.206332 11.2815C-0.0687772 11.7175 -0.0687772 12.2824 0.206332 12.7185L6.95296 23.4113C7.44816 24.1962 8.55185 24.1962 9.04705 23.4113L15.7937 12.7185C16.0688 12.2824 16.0688 11.7175 15.7937 11.2815L9.04705 0.588608Z" />
    </svg>
  );
}

const SIZES = {
  xs: { text: 'text-xs', icon: 12, gap: 'gap-0.5' },
  sm: { text: 'text-sm', icon: 14, gap: 'gap-1' },
  md: { text: 'text-base', icon: 16, gap: 'gap-1' },
  lg: { text: 'text-xl', icon: 20, gap: 'gap-1.5' },
  xl: { text: 'text-3xl', icon: 28, gap: 'gap-2' },
  /** Шапка десктопа: DemiBold 24, иконка 24. */
  xxl: { text: 'text-[24px]', icon: 24, gap: 'gap-3' },
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
      className={cn(
        'inline-flex items-center font-semibold whitespace-nowrap tabular',
        s.text,
        s.gap,
        className,
      )}
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

/** Сумма на акцентной (лаймовой) кнопке: тёмная плашка, чтобы кристалл не сливался с фоном. */
export function GemPill({ value, size = 'sm' }: { value: number; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <span className="clip-cut inline-flex items-center bg-accent-ink px-1.5 py-0.5 text-accent [--cut:4px]">
      <GemAmount value={value} size={size} />
    </span>
  );
}
