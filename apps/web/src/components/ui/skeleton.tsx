import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton clip-cut [--cut:6px]', className)} aria-hidden="true" />;
}
