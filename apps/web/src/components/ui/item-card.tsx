import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { GemAmount } from './gem';

export interface ItemCardProps {
  name: string;
  skin?: string | null;
  imageUrl?: string | null;
  rarityColor: string;
  rarityName?: string;
  price: number;
  selected?: boolean;
  dimmed?: boolean;
  badges?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** Карточка предмета: цвет редкости — полоса и свечение снизу. */
export function ItemCard({
  name,
  skin,
  imageUrl,
  rarityColor,
  rarityName,
  price,
  selected,
  dimmed,
  badges,
  footer,
  onClick,
  size = 'md',
  className,
}: ItemCardProps) {
  // С кнопками в футере вся карточка кнопкой быть не может (кнопка в кнопке) —
  // тогда выбор делает прозрачная кнопка-подложка, а футер лежит поверх неё.
  const overlay = Boolean(onClick && footer);
  const Comp = onClick && !overlay ? 'button' : 'div';
  return (
    <Comp
      type={Comp === 'button' ? 'button' : undefined}
      onClick={overlay ? undefined : onClick}
      className={cn(
        'cut group flex w-full flex-col overflow-hidden text-left transition duration-150',
        '[--cut-bg:var(--color-surface-1)]',
        onClick && 'hover:-translate-y-0.5',
        selected && '[--cut-border:var(--color-accent)]',
        dimmed && 'opacity-40',
        className,
      )}
      style={{ ['--rarity' as string]: rarityColor }}
      aria-pressed={Comp === 'button' ? Boolean(selected) : undefined}
    >
      {overlay && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={Boolean(selected)}
          aria-label={skin ? `${name} | ${skin}` : name}
          className="absolute inset-0 z-[1] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />
      )}
      <div
        className={cn('relative grid place-items-center', size === 'sm' ? 'h-20' : 'h-28 sm:h-32')}
        style={{
          background: `radial-gradient(80% 70% at 50% 100%, ${rarityColor}40, transparent 70%)`,
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className={cn(
              'max-h-[85%] max-w-[85%] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.6)] transition-transform duration-200 group-hover:scale-105',
            )}
          />
        ) : (
          <div className="h-10 w-16 bg-surface-3" />
        )}
        {badges && <div className="absolute left-2 top-2 flex gap-1">{badges}</div>}
      </div>
      <div
        className="h-[3px] w-full"
        style={{ background: rarityColor, boxShadow: `0 0 12px ${rarityColor}` }}
      />
      <div
        className={cn(
          'flex flex-1 flex-col gap-0.5',
          size === 'sm' ? 'px-2 py-1.5' : 'px-3 py-2.5',
        )}
      >
        <div className="truncate text-[11px] text-muted" title={name}>
          {rarityName ? <span style={{ color: rarityColor }}>{rarityName}</span> : name}
        </div>
        <div
          className={cn('truncate font-semibold', size === 'sm' ? 'text-xs' : 'text-sm')}
          title={skin ?? name}
        >
          {skin ?? name}
        </div>
        <GemAmount value={price} size={size === 'sm' ? 'xs' : 'sm'} className="mt-1 text-accent" />
        {footer && <div className={cn(overlay && 'relative z-[2]')}>{footer}</div>}
      </div>
    </Comp>
  );
}
