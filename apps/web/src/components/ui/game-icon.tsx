import { cn } from '@/lib/cn';

/** Значок игры — собственный монограммный бейдж (без логотипов правообладателей). */
export function GameIcon({ shortName, size = 'md', className }: { shortName: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'clip-cut inline-grid shrink-0 place-items-center bg-surface-3 font-display font-extrabold tracking-tight text-accent [--cut:5px]',
        size === 'sm' && 'h-6 w-6 text-[9px]',
        size === 'md' && 'h-8 w-8 text-[11px]',
        size === 'lg' && 'h-12 w-12 text-base',
        className,
      )}
      aria-hidden="true"
    >
      {shortName}
    </span>
  );
}
