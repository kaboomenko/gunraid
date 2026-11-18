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
import { LiveFeedBar } from '@/components/layout/live-feed';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileTabBar } from '@/components/layout/tab-bar';
import { getPublicConfig } from '@/lib/server-api';
import { Providers } from './providers';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  const base = process.env.PUBLIC_URL ?? 'http://localhost:8080';
  return {
    metadataBase: new URL(base),
    title: { default: t('title'), template: '%s · GunRaid' },
    description: t('description'),
    applicationName: 'GunRaid',
    openGraph: { type: 'website', siteName: 'GunRaid', title: t('title'), description: t('description') },
    twitter: { card: 'summary_large_image', title: t('title'), description: t('description') },
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
            <main className="mx-auto min-h-[60vh] max-w-[1440px] px-3 pt-4 sm:px-5 sm:pt-6">{children}</main>
            <SiteFooter supportUrl={config.supportTelegramUrl} />
            <MobileTabBar />
            <LoginModal />
            <AdultGate />
            <Suspense fallback={null}>
              <AuthEffects />
            </Suspense>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
