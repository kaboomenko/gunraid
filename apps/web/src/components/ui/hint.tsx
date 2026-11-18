'use client';

import { Popover } from 'radix-ui';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Подсказка, которая открывается и при наведении (мышь), и по тапу (телефон).
 * Radix Tooltip на тач-устройствах не открывается — поэтому Popover.
 */
export function Hint({
  content,
  children,
  side = 'bottom',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        asChild
        onPointerEnter={(e) => e.pointerType === 'mouse' && hoverOpen()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hoverClose()}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'gr-pop cut z-50 max-w-[280px] px-3.5 py-3 text-sm [--cut-bg:var(--color-surface-2)] [--cut-border:var(--color-line-strong)]',
            className,
          )}
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
