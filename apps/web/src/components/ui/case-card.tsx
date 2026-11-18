import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { GemAmount } from './gem';

export interface CaseCardProps {
  name: string;
  imageUrl?: string | null;
  price: number;
  accentColor?: string;
  badge?: ReactNode;
  meta?: ReactNode;
  href?: string;
  className?: string;
  priceSlot?: ReactNode;
}

/** Карточка кейса на главной. */
export function CaseCard({
  name,
  imageUrl,
  price,
  accentColor = '#C6FF00',
  badge,
  meta,
  className,
  priceSlot,
}: CaseCardProps) {
  return (
    <div
      className={cn(
        'cut group flex flex-col items-center gap-2 px-3 pb-4 pt-3 text-center transition duration-200',
        '[--cut-bg:var(--color-surface-1)] hover:-translate-y-1 hover:[--cut-border:var(--color-line-strong)]',
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 text-[11px]">
        <span>{badge}</span>
        <span className="text-dim">{meta}</span>
      </div>
      <div
        className="relative grid aspect-square w-full place-items-center"
        style={{
          background: `radial-gradient(60% 55% at 50% 55%, ${accentColor}33, transparent 70%)`,
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="max-h-[88%] max-w-[88%] object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
          />
        ) : (
          <div className="h-1/2 w-1/2 bg-surface-3" />
        )}
      </div>
      <div className="line-clamp-2 min-h-10 font-display text-sm font-bold uppercase leading-tight">
        {name}
      </div>
      {priceSlot ?? (
        <div className="clip-cut bg-surface-3 px-3 py-1.5 [--cut:6px]">
          <GemAmount value={price} size="sm" />
        </div>
      )}
    </div>
  );
}
