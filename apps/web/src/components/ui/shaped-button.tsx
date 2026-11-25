import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/** Высота прописных TT Firs Neue — 0.7 кегля. */
export const CAP_HEIGHT = 0.7;

/**
 * Высота фигурной кнопки по правилу макета: самый крупный элемент
 * (иконка или прописные буквы текста) + 24px сверху и снизу.
 */
export function shapeHeight({ fontSize = 0, icon = 0 }: { fontSize?: number; icon?: number }) {
  return Math.max(fontSize * CAP_HEIGHT, icon) + 48;
}

const VARIANTS = {
  /** Сплошная лаймовая (вход, «Забрать бонус»). */
  lime: 'bg-accent text-accent-ink hover:bg-accent-hover',
  /** Лайм 20% с размытием фона (Figma: background blur 12 → CSS blur 6px). */
  glass: 'bg-accent/20 text-accent backdrop-blur-[6px] hover:bg-accent/30',
} as const;

export interface ShapedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  /** Высота в px — см. shapeHeight(). */
  height?: number;
  asChild?: boolean;
}

/** Кнопка формы из шаблона макета (styled-btn-template): срезы 45° слева сверху и справа снизу. */
export const ShapedButton = forwardRef<HTMLButtonElement, ShapedButtonProps>(function ShapedButton(
  { variant = 'lime', height = 72, asChild, className, style, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'shape relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap px-6 font-semibold transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        className,
      )}
      style={{ '--h': `${height}px`, ...style } as CSSProperties}
      {...props}
    />
  );
});
