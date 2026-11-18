import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'cut stripes flex flex-col items-center justify-center gap-3 px-6 py-10 text-center [--cut-bg:var(--color-surface-1)]',
        className,
      )}
    >
      {icon && <div className="text-dim">{icon}</div>}
      {title && <div className="font-display text-lg font-bold uppercase">{title}</div>}
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}
