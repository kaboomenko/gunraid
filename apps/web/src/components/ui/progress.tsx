import { cn } from '@/lib/cn';

export function Progress({
  value,
  max = 100,
  className,
  label,
}: {
  value: number;
  max?: number;
  className?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={cn('clip-cut relative h-2.5 overflow-hidden bg-surface-3 [--cut:4px]', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div
        className="h-full bg-accent shadow-[0_0_12px_rgba(198,255,0,0.6)] transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
