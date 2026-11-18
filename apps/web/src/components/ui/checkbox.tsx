'use client';

import { Check } from 'lucide-react';
import { Checkbox as RCheckbox, Switch as RSwitch } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: ReactNode;
  id: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="clip-cut mt-0.5 grid h-5 w-5 shrink-0 place-items-center bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition [--cut:4px] data-[state=checked]:bg-accent"
      >
        <RCheckbox.Indicator>
          <Check size={14} strokeWidth={3.5} className="text-accent-ink" />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label && (
        <label htmlFor={id} className="cursor-pointer select-none text-sm text-muted">
          {label}
        </label>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="clip-cut relative h-6 w-11 shrink-0 bg-surface-3 transition [--cut:5px] data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <RSwitch.Thumb className="clip-cut block h-4 w-4 translate-x-1 bg-white transition-transform [--cut:3px] data-[state=checked]:translate-x-6 data-[state=checked]:bg-accent-ink" />
    </RSwitch.Root>
  );
}
