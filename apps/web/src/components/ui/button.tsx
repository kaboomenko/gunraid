import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

const VARIANTS = {
  primary:
    'bg-accent text-accent-ink hover:bg-accent-hover active:brightness-95 shadow-[0_0_0_rgba(198,255,0,0)] hover:shadow-[0_6px_28px_-8px_rgba(198,255,0,0.65)]',
  secondary: 'bg-surface-3 text-text hover:bg-line-strong',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2',
  outline:
    'cut [--cut-bg:var(--color-surface-2)] [--cut-border:rgb(198_255_0/0.65)] text-accent hover:[--cut-bg:#232b10]',
  danger: 'bg-danger text-bg hover:brightness-110',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 [--cut:6px]',
  md: 'h-10 px-4 text-sm gap-2 [--cut:8px]',
  lg: 'h-12 px-6 text-base gap-2.5 [--cut:10px]',
  icon: 'h-10 w-10 p-0 [--cut:8px]',
  iconSm: 'h-8 w-8 p-0 [--cut:6px]',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  asChild?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    asChild,
    block,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(
        variant !== 'outline' && 'clip-cut',
        'relative inline-flex select-none items-center justify-center font-display font-bold uppercase tracking-wide transition-all duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner className="absolute" />}
          <span className={cn('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
            {children}
          </span>
        </>
      )}
    </Comp>
  );
});
