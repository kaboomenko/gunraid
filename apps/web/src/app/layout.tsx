import '@fontsource-variable/tektur';
import '@fontsource-variable/golos-text';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';
import { AdultGate } from '@/components/auth/adult-gate';
import { AuthEffects } from '@/components/auth/auth-effects';
import { LoginModal } from '@/components/auth/login-modal';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { LiveFeedBar } from '@/components/layout/live-feed';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileTabBar } from '@/components/layout/tab-bar';
import { DepositModal } from '@/components/payments/deposit-modal';
import { getPublicConfig } from '@/lib/server-api';
import { DEFAULT_OG_IMAGE } from '@/lib/seo';
import { siteUrl } from '@/lib/site';
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
  themeColor: '#0B0B0F',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [config, locale] = await Promise.all([getPublicConfig(), getLocale()]);
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <Providers config={config}>
            <LiveFeedBar />
            <SiteHeader />
            <main className="mx-auto min-h-[60vh] max-w-[1440px] px-3 pt-4 sm:px-5 sm:pt-6">
              {children}
            </main>
            <SiteFooter supportUrl={config.supportTelegramUrl} />
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
