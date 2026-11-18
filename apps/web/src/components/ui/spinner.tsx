import { cn } from '@/lib/cn';

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
      <path d="M12 2a10 10 0 1 0 10 10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
    </svg>
  );
}
