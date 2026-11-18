'use client';

import { Cookie } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { usePrefs, usePrefsHydrated } from '@/lib/store';

/**
 * Уведомление о технических cookie (сессия, CSRF, выбранная игра, реф-код).
 * Аналитики и рекламных cookie нет, поэтому согласие не требуется — только информирование.
 */
export function CookieBanner() {
  const t = useTranslations('cookies');
  const hydrated = usePrefsHydrated();
  const ack = usePrefs((s) => s.cookiesAck);
  const ackCookies = usePrefs((s) => s.ackCookies);
  if (!hydrated || ack) return null;
  return (
    <div
      role="region"
      aria-label={t('more')}
      data-testid="cookie-banner"
      className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+10px)] z-40 mx-auto max-w-xl md:bottom-5"
    >
      <div className="cut cut-sm flex items-center gap-3 p-3 pl-4 shadow-xl shadow-black/50 [--cut-bg:var(--color-surface-3)]">
        <Cookie size={20} className="shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 text-xs text-muted">
          {t('text')}{' '}
          <Link href="/legal/privacy" className="text-text underline-offset-2 hover:underline">
            {t('more')}
          </Link>
        </p>
        <Button size="sm" onClick={ackCookies}>
          {t('accept')}
        </Button>
      </div>
    </div>
  );
}
