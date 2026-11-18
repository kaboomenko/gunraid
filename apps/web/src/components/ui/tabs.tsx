'use client';

import { Tabs as RTabs } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Tabs = RTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List
      className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        'relative shrink-0 px-4 py-3 font-display text-sm font-bold uppercase tracking-wide text-muted transition',
        'hover:text-text data-[state=active]:text-accent',
        'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-accent after:opacity-0 data-[state=active]:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RTabs.Content>) {
  return <RTabs.Content className={cn('pt-5 outline-none', className)} {...props} />;
}
