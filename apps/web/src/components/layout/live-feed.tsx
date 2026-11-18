'use client';

import { useTranslations } from 'next-intl';

/** Лента live-дропов (наполняется в реальном времени с этапа 3). */
export function LiveFeedBar() {
  const t = useTranslations('feed');
  return (
    <div className="relative h-[var(--feed-h)] border-b border-line bg-surface-1/70">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-3 sm:px-5">
        <div className="flex shrink-0 items-center gap-2 font-display text-xs font-extrabold uppercase tracking-widest text-accent">
          <span className="h-2 w-2 bg-accent animate-pulse-dot" aria-hidden="true" />
          {t('title')}
        </div>
        <div className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto" aria-label={t('title')}>
          <span className="truncate text-xs text-dim">{t('empty')}</span>
        </div>
      </div>
    </div>
  );
}
