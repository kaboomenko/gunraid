import type { HomeDto, SiteStatsDto } from '@gunraid/shared';
import { Package } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Banners } from '@/components/home/banners';
import { BonusBanner } from '@/components/home/bonus-banner';
import { CaseBrowser } from '@/components/home/case-browser';
import { ModeGrid } from '@/components/home/mode-grid';
import { StatsStrip } from '@/components/home/stats-strip';
import { EmptyState } from '@/components/ui/empty-state';
import { getPublicConfig, serverGet } from '@/lib/server-api';
import { pageMeta } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const [t, config] = await Promise.all([getTranslations('meta'), getPublicConfig()]);
  const name = config.games.find((g) => g.code === game)?.name ?? game;
  return pageMeta({
    title: t('gameTitle', { game: name }),
    description: t('gameDescription', { game: name }),
    path: `/${game}`,
  });
}

export default async function GameHome({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const [t, stats, home] = await Promise.all([
    getTranslations('home'),
    serverGet<SiteStatsDto>('/stats', { revalidate: 10 }).catch(() => null),
    serverGet<HomeDto>(`/games/${game}/home`, { revalidate: 15 }).catch(() => null),
  ]);
  const freeCase =
    home?.categories
      .flatMap((c) => c.cases)
      .find((c) => c.kind === 'free' && !c.minLevel && !c.supplyTotal) ?? null;
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="space-y-3 md:space-y-6">
        <BonusBanner game={game} freeCaseSlug={freeCase?.slug ?? null} />
        <div id="cases" className="scroll-mt-24 space-y-2">
          {home?.categories.length ? (
            <CaseBrowser game={game} categories={home.categories} />
          ) : (
            <EmptyState icon={<Package size={40} />} text={t('casesEmpty')} />
          )}
          <div className="flex justify-end">
            <Link
              href={`/${game}/items`}
              className="text-sm font-semibold text-accent hover:underline"
            >
              {t('allItems')} →
            </Link>
          </div>
        </div>
      </div>
      {home && <Banners banners={home.banners} />}
      <ModeGrid game={game} />
      <StatsStrip stats={stats} />
    </div>
  );
}
