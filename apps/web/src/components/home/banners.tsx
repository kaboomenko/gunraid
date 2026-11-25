import type { BannerDto } from '@gunraid/shared';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function Banners({ banners }: { banners: BannerDto[] }) {
  if (!banners.length) return null;
  return (
    <div className="no-scrollbar -mx-3 flex snap-x gap-3 overflow-x-auto px-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
      {banners.map((b) => {
        const content = (
          <div
            className="cut cut-lg group relative flex h-28 w-[82vw] shrink-0 snap-start items-center justify-between gap-4 overflow-hidden px-5 sm:h-32 sm:w-auto"
            style={{ background: `linear-gradient(110deg, ${b.accentColor}2e, transparent 60%)` }}
          >
            <div className="min-w-0">
              <div className="font-display text-lg font-extrabold uppercase sm:text-xl">
                {b.title}
              </div>
              {b.subtitle && (
                <div className="mt-1 line-clamp-2 text-xs text-muted sm:text-sm">{b.subtitle}</div>
              )}
            </div>
            <ArrowRight
              className="shrink-0 transition group-hover:translate-x-1"
              style={{ color: b.accentColor }}
            />
          </div>
        );
        return b.link ? (
          <Link key={b.id} href={b.link} className="shrink-0 sm:shrink">
            {content}
          </Link>
        ) : (
          <div key={b.id}>{content}</div>
        );
      })}
    </div>
  );
}
