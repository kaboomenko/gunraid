import type { SiteStatsDto } from '@gunraid/shared';
import { Package } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Hero } from '@/components/home/hero';
import { ModeGrid } from '@/components/home/mode-grid';
import { StatsStrip } from '@/components/home/stats-strip';
import { SectionTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getPublicConfig, serverGet } from '@/lib/server-api';

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('meta'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return {
    title: t('gameTitle', { game: name }),
    description: t('gameDescription', { game: name }),
    alternates: { canonical: `/${game}` },
  };
}

export default async function GameHome({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, config, stats] = await Promise.all([
    getTranslations('home'),
    getPublicConfig(),
    serverGet<SiteStatsDto>('/stats', { revalidate: 10 }).catch(() => null),
  ]);
  const info = config.games.find((g) => g.code === game);
  return (
    <div className="space-y-6 sm:space-y-8">
      <Hero game={game} gameName={info?.name ?? game} shortName={info?.shortName ?? ''} />
      <StatsStrip stats={stats} />
      <ModeGrid game={game} />
      <section id="cases" className="scroll-mt-24">
        <SectionTitle
          action={
            <Link href={`/${game}/items`} className="text-sm font-semibold text-accent hover:underline">
              {t('allItems')} →
            </Link>
          }
        >
          {t('casesTitle')}
        </SectionTitle>
        <EmptyState icon={<Package size={40} />} text={t('casesEmpty')} />
      </section>
    </div>
  );
}
