'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CookieIcon, DeclineIcon, ShieldCheckIcon } from '@/components/icons/design-icons';
import { cn } from '@/lib/cn';
import { usePrefs, usePrefsHydrated } from '@/lib/store';

/**
 * Кнопка плашки (макет): скругление 12, DemiBold 24, иконка 24, между иконкой и текстом 24,
 * поля 24 и 36 справа.
 */
const BUTTON =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-[12px] py-6 pl-6 pr-9 text-[24px] font-semibold transition';

/**
 * Уведомление о cookie (макет): плашка в правом нижнем углу в 24px от краёв, #181821, скругление 36,
 * поля 24; иконка 36 + 24 + заголовок DemiBold 36; через 24 — текст Medium 24 (межстрочный 100%,
 * как везде), через 36 — кнопки «Отклонить» (лайм 10% / лайм) и «Принять все» (лайм / #181821),
 * между ними 24. Ширину плашки задаёт ряд кнопок, текст переносится по ней.
 * «Отклонить» — только обязательные cookie (вход, защита, настройки), «Принять все» — ещё и
 * необязательные (аналитика): выбор хранится в настройках (cookieConsent).
 * На телефоне плашка над нижним меню и уменьшена целиком.
 */
export function CookieBanner() {
  const t = useTranslations('cookies');
  const hydrated = usePrefsHydrated();
  const consent = usePrefs((s) => s.cookieConsent);
  const setConsent = usePrefs((s) => s.setCookieConsent);
  if (!hydrated || consent) return null;
  return (
    <div
      role="region"
      aria-labelledby="cookie-banner-title"
      data-testid="cookie-banner"
      className="fixed bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] right-3 z-40 flex md:bottom-6 md:right-6"
    >
      {/* Плашка — flex-элемент обёртки, а не строчный блок: иначе обрезка текста по базовой линии
          (text-box) срезала бы высоту обёртки и низ плашки уходил за экран. */}
      <div className="flex flex-col rounded-[36px] bg-surface-1 p-6 shadow-[0_18px_48px_rgb(0_0_0/0.55)] max-sm:[zoom:0.58] sm:max-md:[zoom:0.8]">
        <div className="flex items-center gap-6">
          <CookieIcon size={36} className="shrink-0 text-white" />
          <h2 id="cookie-banner-title" className="whitespace-nowrap text-[36px] font-semibold">
            {t('title')}
          </h2>
        </div>
        {/* w-0 min-w-full: текст не расширяет плашку, а переносится по ширине ряда кнопок. */}
        <p className="mt-6 w-0 min-w-full text-[24px] font-medium text-white">
          {t.rich('text', {
            link: (chunks: ReactNode) => (
              <Link
                href="/legal/cookies"
                className="text-lime underline decoration-1 underline-offset-[5px] hover:brightness-110"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        <div className="mt-9 flex gap-6">
          <button
            type="button"
            onClick={() => setConsent('necessary')}
            className={cn(BUTTON, 'bg-lime/10 text-lime hover:bg-lime/15')}
          >
            <DeclineIcon />
            {t('decline')}
          </button>
          <button
            type="button"
            onClick={() => setConsent('all')}
            className={cn(BUTTON, 'bg-lime text-[#181821] hover:brightness-110')}
          >
            <ShieldCheckIcon />
            {t('accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
