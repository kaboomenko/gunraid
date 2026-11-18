import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const TONES = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent text-accent-ink',
  soft: 'bg-accent-soft text-accent',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
} as const;

export function Badge({
  tone = 'neutral',
  className,
  color,
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES; color?: string }) {
  return (
    <span
      className={cn(
        'clip-cut inline-flex h-6 items-center gap-1 px-2 text-[11px] font-bold uppercase tracking-wider [--cut:5px]',
        TONES[tone],
        className,
      )}
      style={color ? { backgroundColor: `${color}26`, color, ...style } : style}
      {...props}
    />
  );
}
