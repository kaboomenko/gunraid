import './globals.css';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';
import { AdultGate } from '@/components/auth/adult-gate';
import { AuthEffects } from '@/components/auth/auth-effects';
import { LoginModal } from '@/components/auth/login-modal';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { PromoStrip } from '@/components/layout/promo-strip';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileTabBar } from '@/components/layout/tab-bar';
import { TopBar } from '@/components/layout/top-bar';
import { DepositModal } from '@/components/payments/deposit-modal';
import { getPublicConfig } from '@/lib/server-api';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';
import { siteUrl } from '@/lib/site';
import { firsNeue } from './fonts';
import { Providers } from './providers';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t('title'), template: '%s · GunRaid' },
    description: t('description'),
    applicationName: 'GunRaid',
    openGraph: {
      type: 'website',
      siteName: 'GunRaid',
      locale: 'ru_RU',
      title: t('title'),
      description: t('description'),
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [DEFAULT_OG_IMAGE.url],
    },
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = {
  themeColor: '#121117',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [config, locale] = await Promise.all([getPublicConfig(), getLocale()]);
  return (
    <html lang={locale} className={firsNeue.variable}>
      <body>
        <NextIntlClientProvider>
          <Providers config={config}>
            {/* Поля страницы — 24px со всех сторон (макет 1920: контент 1872); габариты — не шире 16:9. */}
            <div className="page-frame flex min-h-dvh flex-col">
              <div className="space-y-3 px-3 pt-3 md:space-y-6 md:px-6 md:pt-6">
                <PromoStrip />
                <TopBar />
              </div>
              <SiteHeader />
              <main className="min-h-[60vh] flex-1 px-3 pt-4 md:px-6 md:pt-6">{children}</main>
              <SiteFooter supportUrl={config.supportTelegramUrl} />
            </div>
            <MobileTabBar />
            <LoginModal />
            <AdultGate />
            <DepositModal />
            <CookieBanner />
            <Suspense fallback={null}>
              <AuthEffects />
            </Suspense>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
