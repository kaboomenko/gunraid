'use client';

import { DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Dropdown = DropdownMenu.Root;
export const DropdownTrigger = DropdownMenu.Trigger;

export function DropdownContent({ className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'gr-pop cut z-50 min-w-[200px] p-1.5 [--cut-bg:var(--color-surface-2)] [--cut-border:var(--color-line-strong)]',
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function DropdownItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 px-3 py-2.5 text-sm text-muted outline-none transition',
        'data-[highlighted]:bg-surface-3 data-[highlighted]:text-text data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export function DropdownLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn('px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-dim', className)}
      {...props}
    />
  );
}
