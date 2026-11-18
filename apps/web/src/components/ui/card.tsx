import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'raised' | 'accent';
  cut?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

/** Карточка с рублеными углами и обводкой. */
export function Card({
  tone = 'default',
  cut = 'md',
  interactive,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'cut',
        cut === 'sm' && 'cut-sm',
        cut === 'lg' && 'cut-lg',
        tone === 'raised' && '[--cut-bg:var(--color-surface-2)]',
        tone === 'accent' && '[--cut-border:rgb(198_255_0/0.45)] [--cut-bg:var(--color-surface-2)]',
        interactive &&
          'transition-transform duration-150 hover:-translate-y-0.5 hover:[--cut-border:var(--color-line-strong)]',
        className,
      )}
      {...props}
    />
  );
}

export function SectionTitle({
  children,
  className,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('mb-4 flex items-end justify-between gap-3', className)}>
      <h2 className="font-display text-xl font-extrabold uppercase tracking-wide sm:text-2xl">
        <span
          className="mr-2 inline-block h-4 w-1.5 -skew-x-12 bg-accent align-middle"
          aria-hidden="true"
        />
        {children}
      </h2>
      {action}
    </div>
  );
}
