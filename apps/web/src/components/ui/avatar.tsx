import { cn } from '@/lib/cn';

const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl', xl: 'h-20 w-20 text-2xl' } as const;

export function Avatar({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn(
        'clip-cut relative inline-grid shrink-0 place-items-center overflow-hidden bg-surface-3 font-display font-bold text-accent [--cut:6px]',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        // Аватары из Steam/Google/Telegram — внешние URL, без оптимизации Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
